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
import path from 'node:path';
import { parse as shellParse, type ParseEntry } from 'shell-quote';
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
import type { PolicyEngine } from '../policy/policy-engine.js';
import { PolicyDecision } from '../policy/types.js';

export interface AcpAgentProtocolOptions {
  workspaceDir?: string;
  authMethodId?: string;
  processManager?: AcpProcessManager;
  mode?: 'plan' | 'accept-edits' | 'default';
  getMode?: () => string;
  policyEngine?: PolicyEngine;
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null;
}

const FILE_WRITE_TOOLS = new Set([
  'edit_file',
  'write_file',
  'replace',
  'create_file',
  'delete_file',
  'patch_file',
  'append_file',
]);

const READ_ONLY_TOOLS = new Set([
  'read_file',
  'list_directory',
  'ls',
  'glob',
  'grep_search',
  'read_many_files',
  'google_web_search',
  'codebase_investigator',
  'cli_help',
  'get_internal_docs',
  'read_mcp_resource',
  'list_mcp_resources',
]);

const MUTATING_SHELL_BINARIES = new Set([
  'rm',
  'mv',
  'cp',
  'touch',
  'mkdir',
  'rmdir',
  'sed',
  'awk',
  'truncate',
  'dd',
  'chmod',
  'chown',
  'ln',
  'tee',
  'patch',
]);

const GIT_MUTATING_SUBCOMMANDS = new Set([
  'commit',
  'push',
  'merge',
  'rebase',
  'reset',
  'checkout',
  'switch',
  'branch',
  'clean',
  'stash',
  'cherry-pick',
  'revert',
  'tag',
  'mv',
  'rm',
]);

const PKG_MUTATING_SUBCOMMANDS = new Set([
  'install',
  'i',
  'add',
  'remove',
  'uninstall',
  'update',
  'upgrade',
  'publish',
  'link',
  'unlink',
]);

const PIP_MUTATING_SUBCOMMANDS = new Set(['install', 'uninstall']);

export function isCommandWriteOperation(commandStr: string): boolean {
  if (!commandStr || typeof commandStr !== 'string') return false;

  let entries: ParseEntry[];
  try {
    entries = shellParse(commandStr);
  } catch {
    const firstWord = commandStr.trim().split(/\s+/)[0]?.toLowerCase();
    const cleanFirstWord = firstWord
      ? path.basename(firstWord).replace(/\.exe$/, '')
      : '';
    return MUTATING_SHELL_BINARIES.has(cleanFirstWord);
  }

  const commandSegments: string[][] = [];
  let currentSegment: string[] = [];

  for (const entry of entries) {
    if (typeof entry === 'object' && entry !== null && 'op' in entry) {
      if (entry.op.includes('>')) {
        return true;
      }
      if ([';', '&&', '||', '|', '&'].includes(entry.op)) {
        if (currentSegment.length > 0) {
          commandSegments.push(currentSegment);
          currentSegment = [];
        }
        continue;
      }
    } else if (typeof entry === 'string') {
      currentSegment.push(entry);
    }
  }
  if (currentSegment.length > 0) {
    commandSegments.push(currentSegment);
  }

  for (const seg of commandSegments) {
    if (seg.length === 0) continue;

    let cmdIdx = 0;
    while (cmdIdx < seg.length) {
      const token = seg[cmdIdx];
      if (/^[a-zA-Z_][a-zA-Z0-9_]*=/.test(token)) {
        cmdIdx++;
        continue;
      }
      const lower = token.toLowerCase();
      if (['sudo', 'env', 'time', 'nohup'].includes(lower)) {
        cmdIdx++;
        while (cmdIdx < seg.length) {
          const opt = seg[cmdIdx];
          if (/^[a-zA-Z_][a-zA-Z0-9_]*=/.test(opt)) {
            cmdIdx++;
            continue;
          }
          if (opt.startsWith('-')) {
            cmdIdx++;
            if (
              ['-u', '-g', '-C', '-h', '-p', '-f'].includes(opt) &&
              cmdIdx < seg.length &&
              !seg[cmdIdx].startsWith('-')
            ) {
              cmdIdx++;
            }
            continue;
          }
          break;
        }
        continue;
      }
      break;
    }
    if (cmdIdx >= seg.length) continue;

    const rawExecutable = seg[cmdIdx];
    const executable = path
      .basename(rawExecutable)
      .toLowerCase()
      .replace(/\.exe$/, '');

    if (MUTATING_SHELL_BINARIES.has(executable)) {
      return true;
    }

    const restArgs = seg.slice(cmdIdx + 1);

    if (executable === 'git') {
      let subCmdIdx = 0;
      while (subCmdIdx < restArgs.length) {
        const arg = restArgs[subCmdIdx];
        if (
          arg === '-C' ||
          arg === '-c' ||
          arg === '--git-dir' ||
          arg === '--work-tree'
        ) {
          subCmdIdx += 2;
          continue;
        }
        if (arg.startsWith('-')) {
          subCmdIdx++;
          continue;
        }
        break;
      }
      const subCmd = restArgs[subCmdIdx]?.toLowerCase();
      if (subCmd && GIT_MUTATING_SUBCOMMANDS.has(subCmd)) {
        return true;
      }
    }

    if (
      executable === 'npm' ||
      executable === 'yarn' ||
      executable === 'pnpm' ||
      executable === 'bun'
    ) {
      let subCmdIdx = 0;
      while (subCmdIdx < restArgs.length) {
        const arg = restArgs[subCmdIdx];
        if (arg === '--prefix' || arg === '-w' || arg === '--workspace') {
          subCmdIdx += 2;
          continue;
        }
        if (arg.startsWith('-')) {
          subCmdIdx++;
          continue;
        }
        break;
      }
      const subCmd = restArgs[subCmdIdx]?.toLowerCase();
      if (subCmd && PKG_MUTATING_SUBCOMMANDS.has(subCmd)) {
        return true;
      }
    }

    if (executable === 'pip' || executable === 'pip3') {
      let subCmdIdx = 0;
      while (subCmdIdx < restArgs.length) {
        const arg = restArgs[subCmdIdx];
        if (
          [
            '--timeout',
            '--retries',
            '--proxy',
            '--cert',
            '--client-cert',
            '--cache-dir',
            '--index-url',
            '--extra-index-url',
            '--find-links',
            '-t',
          ].includes(arg)
        ) {
          subCmdIdx += 2;
          continue;
        }
        if (arg.startsWith('-')) {
          subCmdIdx++;
          continue;
        }
        break;
      }
      const subCmd = restArgs[subCmdIdx]?.toLowerCase();
      if (subCmd && PIP_MUTATING_SUBCOMMANDS.has(subCmd)) {
        return true;
      }
    }

    if (executable === 'python' || executable === 'python3' || executable === 'py') {
      const mIdx = restArgs.findIndex((a) => a === '-m');
      if (mIdx !== -1 && restArgs[mIdx + 1]?.toLowerCase() === 'pip') {
        const pipArgs = restArgs.slice(mIdx + 2);
        let subCmdIdx = 0;
        while (subCmdIdx < pipArgs.length) {
          const arg = pipArgs[subCmdIdx];
          if (
            [
              '--timeout',
              '--retries',
              '--proxy',
              '--cert',
              '--client-cert',
              '--cache-dir',
              '--index-url',
              '--extra-index-url',
              '--find-links',
              '-t',
            ].includes(arg)
          ) {
            subCmdIdx += 2;
            continue;
          }
          if (arg.startsWith('-')) {
            subCmdIdx++;
            continue;
          }
          break;
        }
        const subCmd = pipArgs[subCmdIdx]?.toLowerCase();
        if (subCmd && PIP_MUTATING_SUBCOMMANDS.has(subCmd)) {
          return true;
        }
      }
    }
  }

  return false;
}

export function isWriteTool(
  name: string,
  title?: string,
  args?: unknown,
  kindOrPolicyEngine?: string | PolicyEngine,
  _policyEngine?: PolicyEngine,
): boolean {
  let kind: string | undefined;
  if (typeof kindOrPolicyEngine === 'string') {
    kind = kindOrPolicyEngine;
  }

  // 1. Tool classification by ACP ToolKind if provided
  if (kind) {
    const normalizedKind = kind.toLowerCase();
    if (
      normalizedKind === 'edit' ||
      normalizedKind === 'delete' ||
      normalizedKind === 'move'
    ) {
      return true;
    }
    if (
      normalizedKind === 'read' ||
      normalizedKind === 'search' ||
      normalizedKind === 'think' ||
      normalizedKind === 'fetch'
    ) {
      return false;
    }
  }

  const normalizedName = (name || '').toLowerCase().trim();
  const normalizedTitle = (title || '').toLowerCase().trim();

  // 2. Explicit read-only tools
  if (
    READ_ONLY_TOOLS.has(normalizedName) ||
    READ_ONLY_TOOLS.has(normalizedTitle)
  ) {
    return false;
  }

  // 3. Explicit write / file editing tools
  if (
    FILE_WRITE_TOOLS.has(normalizedName) ||
    FILE_WRITE_TOOLS.has(normalizedTitle) ||
    normalizedName.startsWith('write_') ||
    normalizedName.startsWith('edit_') ||
    normalizedName.startsWith('patch_') ||
    normalizedName.startsWith('delete_') ||
    normalizedName.startsWith('append_')
  ) {
    return true;
  }

  // 4. Shell / command execution tools
  const isShellTool =
    normalizedName === 'run_shell_command' ||
    normalizedName === 'execute_command' ||
    normalizedName === 'command' ||
    normalizedName === 'shell' ||
    normalizedName === 'bash' ||
    normalizedName === 'run_command' ||
    normalizedTitle.includes('shell') ||
    normalizedTitle.includes('command');

  if (isShellTool) {
    if (isRecord(args)) {
      const cmd = String(
        args['command'] ||
          args['CommandLine'] ||
          args['cmd'] ||
          args['input'] ||
          '',
      );
      if (cmd) {
        return isCommandWriteOperation(cmd);
      }
    } else if (typeof args === 'string') {
      return isCommandWriteOperation(args);
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

  getProcessManager(): AcpProcessManager {
    return this.processManager;
  }

  async setModel(modelId: string): Promise<void> {
    if (modelId === 'auto') {
      debugLogger.warn('Ignoring /model auto in Antigravity ACP mode');
      return;
    }
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
        requestPermission: (params: RequestPermissionRequest) =>
          this.requestPermission(params),
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

  async requestPermission(
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    const currentMode = this.getMode().toLowerCase();
    const toolCall = params.toolCall;
    if (toolCall) {
      if (this.options.policyEngine) {
        try {
          const res = await this.options.policyEngine.check(
            {
              name: toolCall.title || 'tool',
              args: isRecord(toolCall.rawInput) ? toolCall.rawInput : {},
            },
            undefined,
          );
          if (
            res.decision === PolicyDecision.DENY ||
            String(res.decision).toLowerCase() === 'deny'
          ) {
            return {
              outcome: {
                outcome: 'cancelled',
              },
            };
          }
        } catch {
          // Ignore check failures and proceed to plan mode check
        }
      }

      if (currentMode === 'plan') {
        const isWrite = isWriteTool(
          toolCall.title || '',
          toolCall.title ?? undefined,
          toolCall.rawInput,
          toolCall.kind ?? undefined,
          this.options.policyEngine,
        );

        if (isWrite) {
          return {
            outcome: {
              outcome: 'cancelled',
            },
          };
        }
      }
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
        isWriteTool(
          update.title || '',
          update.title,
          update.rawInput,
          update.kind ?? undefined,
          this.options.policyEngine,
        )
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
