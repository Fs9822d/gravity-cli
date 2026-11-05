/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Modifications Copyright 2026 Gravity Project Maintainers
 * Licensed under the Apache License, Version 2.0
 */

import {
  ClientSideConnection,
  ndJsonStream,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type NewSessionResponse,
  type ContentBlock,
  type InitializeResponse,
} from '@agentclientprotocol/sdk';
import { Writable, Readable } from 'node:stream';
import { v4 as uuidv4 } from 'uuid';
import type {
  AgentProtocol,
  AgentEvent,
  AgentSend,
  ContentPart,
  Unsubscribe,
  StreamEndReason,
} from './types.js';
import { AcpProcessManager } from './acp-process-manager.js';
import { debugLogger } from '../utils/debugLogger.js';

export interface AcpAgentProtocolOptions {
  workspaceDir?: string;
  authMethodId?: string;
  processManager?: AcpProcessManager;
  mode?: 'plan' | 'accept-edits' | 'default';
  getMode?: () => string;
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null;
}

function isWriteTool(name: string, title?: string, args?: unknown): boolean {
  const normalized = (name || title || '').toLowerCase();
  const writeKeywords = [
    'edit_file',
    'write_file',
    'edit',
    'write',
    'create_file',
    'delete_file',
    'patch_file',
    'append_file',
  ];
  if (writeKeywords.some((w) => normalized.includes(w))) {
    return true;
  }
  if (normalized.includes('command') || normalized.includes('shell')) {
    if (isRecord(args)) {
      const cmd = String(
        args['command'] || args['CommandLine'] || args['cmd'] || '',
      ).toLowerCase();
      const writeOps = [
        'rm ',
        'mv ',
        'cp ',
        'touch ',
        'mkdir ',
        'sed ',
        'git commit',
        'git push',
        'npm install',
        'pip install',
      ];
      if (writeOps.some((op) => cmd.includes(op))) {
        return true;
      }
    }
  }
  return false;
}

function mapStopReason(stopReason?: string): StreamEndReason {
  switch (stopReason) {
    case 'end_turn':
      return 'completed';
    case 'cancelled':
      return 'aborted';
    case 'max_tokens':
    case 'max_turn_requests':
      return 'max_turns';
    case 'refusal':
      return 'failed';
    default:
      return 'completed';
  }
}

/**
 * AcpAgentProtocol implements AgentProtocol interfacing directly with
 * Google Antigravity runtime (agy) via the Agent Client Protocol (ACP) over stdio.
 */
export class AcpAgentProtocol implements AgentProtocol {
  private connection?: ClientSideConnection;
  private sessionId?: string;
  private subscribers = new Set<(event: AgentEvent) => void>();
  private _events: AgentEvent[] = [];
  private currentStreamId: string | null = null;
  private initialized = false;
  private initPromise?: Promise<void>;
  private processManager: AcpProcessManager;
  private options: AcpAgentProtocolOptions;
  private mode: 'plan' | 'accept-edits' | 'default' = 'default';
  private blockedToolCalls = new Set<string>();

  constructor(
    processManagerOrOptions?: AcpProcessManager | AcpAgentProtocolOptions,
    options?: AcpAgentProtocolOptions,
  ) {
    if (processManagerOrOptions instanceof AcpProcessManager) {
      this.processManager = processManagerOrOptions;
      this.options = options || {};
    } else if (processManagerOrOptions) {
      this.options = processManagerOrOptions;
      this.processManager =
        processManagerOrOptions.processManager || new AcpProcessManager();
    } else {
      this.options = {};
      this.processManager = new AcpProcessManager();
    }
    if (this.options.mode) {
      this.mode = this.options.mode;
    }
  }

  setMode(mode: 'plan' | 'accept-edits' | 'default'): void {
    this.mode = mode;
  }

  getMode(): string {
    if (this.options.getMode) {
      return this.options.getMode();
    }
    return this.mode;
  }

  getConnection(): ClientSideConnection | undefined {
    return this.connection;
  }

  async setModel(modelId: string): Promise<void> {
    if (this.connection && this.sessionId) {
      try {
        await this.connection.unstable_setSessionModel({
          sessionId: this.sessionId,
          modelId,
        });
      } catch (err: unknown) {
        debugLogger.warn(
          'Failed to set ACP session model: %s',
          err instanceof Error ? err.message : JSON.stringify(err),
        );
      }
    }
  }

  async setSessionMode(modeId: string): Promise<void> {
    if (
      modeId === 'plan' ||
      modeId === 'accept-edits' ||
      modeId === 'default'
    ) {
      this.mode = modeId;
    } else {
      this.mode = 'default';
    }
    if (this.connection && this.sessionId) {
      try {
        await this.connection.setSessionMode({
          sessionId: this.sessionId,
          modeId,
        });
      } catch (err: unknown) {
        debugLogger.warn(
          'Failed to set ACP session mode: %s',
          err instanceof Error ? err.message : JSON.stringify(err),
        );
      }
    }
  }

  get events(): readonly AgentEvent[] {
    return this._events;
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  subscribe(callback: (event: AgentEvent) => void): Unsubscribe {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  private _emit(event: AgentEvent): void {
    this._events.push(event);
    for (const callback of this.subscribers) {
      try {
        callback(event);
      } catch {
        // Prevent subscriber errors from bubbling into protocol
      }
    }
  }

  /**
   * Initializes the ACP stdio transport and establishes a session.
   */
  async initialize(workspaceDir?: string): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const targetDir =
        workspaceDir || this.options.workspaceDir || process.cwd();
      const child = await this.processManager.spawn(targetDir);

      if (!child.stdin || !child.stdout) {
        throw new Error(
          'Failed to spawn Antigravity ACP process: missing stdio streams',
        );
      }

      let stderrBuffer = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
        if (stderrBuffer.length > 2048) {
          stderrBuffer = stderrBuffer.slice(-2048);
        }
      });

      child.once('exit', (code, signal) => {
        if (!this.initialized) {
          debugLogger.warn(
            `Antigravity ACP process exited (code: ${code}, signal: ${signal}). Stderr: ${stderrBuffer.trim()}`,
          );
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const stdinWeb = Writable.toWeb(
        child.stdin,
      ) as unknown as WritableStream<Uint8Array>;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const stdoutWeb = Readable.toWeb(
        child.stdout,
      ) as unknown as ReadableStream<Uint8Array>;
      const stream = ndJsonStream(stdinWeb, stdoutWeb);

      const clientHandler: Client = {
        requestPermission: async (
          params: RequestPermissionRequest,
        ): Promise<RequestPermissionResponse> => {
          const currentMode = this.getMode().toLowerCase();
          const toolCall = params.toolCall;
          if (
            currentMode === 'plan' &&
            toolCall &&
            isWriteTool(
              toolCall.title || '',
              toolCall.title ?? undefined,
              toolCall.rawInput,
            )
          ) {
            return {
              outcome: {
                outcome: 'cancelled',
              },
            };
          }
          const selectedOption = params.options[0]?.optionId;
          if (selectedOption) {
            return {
              outcome: {
                outcome: 'selected',
                optionId: selectedOption,
              },
            };
          }
          return {
            outcome: {
              outcome: 'cancelled',
            },
          };
        },
        sessionUpdate: async (notification: SessionNotification) => {
          this.handleSessionUpdate(notification);
        },
      };

      const conn = new ClientSideConnection(() => clientHandler, stream);
      this.connection = conn;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const initRes: InitializeResponse = await conn.initialize({
        protocolVersion: 1,
        clientInfo: {
          name: 'gravity',
          version: '1.0.0',
        },
        clientCapabilities: {},
      });

      let sessionRes: NewSessionResponse | undefined;
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        sessionRes = await conn.newSession({
          cwd: targetDir,
          mcpServers: [],
        });
      } catch (err: unknown) {
        if (
          isRecord(err) &&
          (err['code'] === -32000 ||
            String(err['message']).toLowerCase().includes('auth'))
        ) {
          const authMethods = initRes.authMethods;
          const methodId =
            this.options.authMethodId ??
            (authMethods && authMethods.length > 0
              ? authMethods[0].id
              : 'oauth-personal');
          try {
            await conn.authenticate({ methodId });
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            sessionRes = await conn.newSession({
              cwd: targetDir,
              mcpServers: [],
            });
          } catch {
            // Authentication attempted; surface error below if still failing
          }
        }
        if (!sessionRes) {
          const details = stderrBuffer.trim()
            ? ` Stderr: ${stderrBuffer.trim()}`
            : '';
          throw new Error(
            `Failed to establish Antigravity ACP session: ${err instanceof Error ? err.message : String(err)}.${details}`,
          );
        }
      }

      if (sessionRes?.sessionId) {
        this.sessionId = sessionRes.sessionId;
      } else {
        this.sessionId = uuidv4();
      }

      this.initialized = true;

      const activeSessionId = this.sessionId;
      this._emit({
        id: uuidv4(),
        streamId: activeSessionId,
        timestamp: new Date().toISOString(),
        type: 'initialize',
        sessionId: activeSessionId,
        workspace: targetDir,
        agentId: 'antigravity',
      });
    })();

    return this.initPromise;
  }

  private handleSessionUpdate(notification: SessionNotification): void {
    const update = notification.update;
    const streamId = this.currentStreamId || this.sessionId || 'default';
    const now = new Date().toISOString();

    if (update.sessionUpdate === 'agent_thought_chunk') {
      const thoughtText =
        update.content && update.content.type === 'text'
          ? update.content.text
          : '';
      if (thoughtText) {
        this._emit({
          id: uuidv4(),
          streamId,
          timestamp: now,
          type: 'message',
          role: 'agent',
          content: [{ type: 'thought', thought: thoughtText }],
        });
      }
    } else if (update.sessionUpdate === 'agent_message_chunk') {
      const msgText =
        update.content && update.content.type === 'text'
          ? update.content.text
          : '';
      if (msgText) {
        this._emit({
          id: uuidv4(),
          streamId,
          timestamp: now,
          type: 'message',
          role: 'agent',
          content: [{ type: 'text', text: msgText }],
        });
      }
    } else if (update.sessionUpdate === 'tool_call') {
      const currentMode = this.getMode().toLowerCase();
      const toolArgs = isRecord(update.rawInput)
        ? { ...update.rawInput }
        : { input: update.rawInput };

      if (
        currentMode === 'plan' &&
        isWriteTool(update.title || '', update.title, update.rawInput)
      ) {
        this.blockedToolCalls.add(update.toolCallId);
      }

      this._emit({
        id: uuidv4(),
        streamId,
        timestamp: now,
        type: 'tool_request',
        requestId: update.toolCallId,
        name: update.title || 'tool',
        args: toolArgs,
        display: {
          name: update.title,
          description: update.title,
        },
        _meta: {
          legacyState: {
            displayName: update.title,
            description: update.title,
          },
        },
      });
    } else if (update.sessionUpdate === 'tool_call_update') {
      const isFinished =
        update.status === 'completed' || update.status === 'failed';
      if (isFinished) {
        if (this.blockedToolCalls.has(update.toolCallId)) {
          this.blockedToolCalls.delete(update.toolCallId);
          const errorMsg = 'Write tool call error, harness in Plan mode';
          this._emit({
            id: uuidv4(),
            streamId,
            timestamp: now,
            type: 'tool_response',
            requestId: update.toolCallId,
            name: update.title || 'tool',
            isError: true,
            data: { error: errorMsg },
            display: {
              resultSummary: errorMsg,
              result: { type: 'text', text: errorMsg },
            },
          });
          return;
        }

        const toolData = isRecord(update.rawOutput)
          ? { ...update.rawOutput }
          : { output: update.rawOutput };
        const rawOutputStr =
          typeof update.rawOutput === 'string'
            ? update.rawOutput
            : update.rawOutput !== undefined
              ? JSON.stringify(update.rawOutput)
              : '';
        this._emit({
          id: uuidv4(),
          streamId,
          timestamp: now,
          type: 'tool_response',
          requestId: update.toolCallId,
          name: update.title || 'tool',
          isError: update.status === 'failed',
          data: toolData,
          display: {
            resultSummary: rawOutputStr,
            result: rawOutputStr ? { type: 'text', text: rawOutputStr } : null,
          },
        });
      } else {
        let legacyStatus = 'executing';
        if (update.status === 'pending') legacyStatus = 'scheduled';
        else if (update.status === 'in_progress') legacyStatus = 'executing';
        else if (update.status) legacyStatus = update.status;

        this._emit({
          id: uuidv4(),
          streamId,
          timestamp: now,
          type: 'tool_update',
          requestId: update.toolCallId,
          display: {
            name: update.title ?? undefined,
          },
          _meta: {
            legacyState: {
              status: legacyStatus,
              description: update.title ?? undefined,
            },
          },
        });
      }
    } else if (update.sessionUpdate === 'usage_update') {
      this._emit({
        id: uuidv4(),
        streamId,
        timestamp: now,
        type: 'usage',
        model: 'antigravity',
        inputTokens: update.used,
        outputTokens: undefined,
        cost: update.cost
          ? {
              amount: update.cost.amount,
              currency: update.cost.currency ?? undefined,
            }
          : undefined,
      });
    }
  }

  /**
   * Dispatches user prompt to ACP session and coordinates stream events.
   */
  async send(payload: AgentSend): Promise<{ streamId: string | null }> {
    if (!this.initialized) {
      await this.initialize();
    }

    const streamId = uuidv4();
    this.currentStreamId = streamId;
    const now = new Date().toISOString();

    if (payload.message) {
      const userContent: ContentPart[] = payload.message.displayContent
        ? [{ type: 'text', text: payload.message.displayContent }]
        : payload.message.content;
      this._emit({
        id: uuidv4(),
        streamId,
        timestamp: now,
        type: 'message',
        role: 'user',
        content: userContent,
        _meta: payload._meta,
      });
    }

    void Promise.resolve().then(async () => {
      this._emit({
        id: uuidv4(),
        streamId,
        timestamp: new Date().toISOString(),
        type: 'agent_start',
      });

      try {
        let promptText = '';
        if (payload.message) {
          promptText = payload.message.content
            .filter((p) => p.type === 'text')
            .map((p) => (p as { type: 'text'; text: string }).text)
            .join('\n');
        } else if (payload.action) {
          promptText = `Action: ${payload.action.type}`;
        } else if (payload.update) {
          promptText = `Update: ${JSON.stringify(payload.update)}`;
        }

        if (this.connection && this.sessionId) {
          const promptBlocks: ContentBlock[] = [
            {
              type: 'text',
              text: promptText,
            },
          ];

          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const res = await this.connection.prompt({
            sessionId: this.sessionId,
            prompt: promptBlocks,
          });

          const stopReason = mapStopReason(res?.stopReason);
          this._emit({
            id: uuidv4(),
            streamId,
            timestamp: new Date().toISOString(),
            type: 'agent_end',
            reason: stopReason,
          });
        } else {
          this._emit({
            id: uuidv4(),
            streamId,
            timestamp: new Date().toISOString(),
            type: 'agent_end',
            reason: 'completed',
          });
        }
      } catch (error: unknown) {
        this._emit({
          id: uuidv4(),
          streamId,
          timestamp: new Date().toISOString(),
          type: 'error',
          status: 'INTERNAL',
          message: error instanceof Error ? error.message : String(error),
          fatal: false,
        });
        this._emit({
          id: uuidv4(),
          streamId,
          timestamp: new Date().toISOString(),
          type: 'agent_end',
          reason: 'failed',
        });
      } finally {
        if (this.currentStreamId === streamId) {
          this.currentStreamId = null;
        }
      }
    });

    return { streamId };
  }

  /**
   * Aborts active session operation via ACP session/cancel.
   */
  async abort(): Promise<void> {
    if (this.connection && this.sessionId) {
      try {
        await this.connection.cancel({ sessionId: this.sessionId });
      } catch {
        // Suppress cancel notification errors
      }
    }
  }

  /**
   * Cleans up protocol connection and terminates underlying process.
   */
  async close(): Promise<void> {
    await this.abort();
    await this.processManager.stop();
  }
}
