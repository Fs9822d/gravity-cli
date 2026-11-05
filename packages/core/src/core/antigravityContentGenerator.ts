/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GenerateContentResponse,
  type CountTokensResponse,
  type GenerateContentParameters,
  type CountTokensParameters,
  EmbedContentResponse,
  type EmbedContentParameters,
  FinishReason,
} from '@google/genai';
import type { ContentGenerator } from './contentGenerator.js';
import type { UserTierId } from '../code_assist/types.js';
import type { LlmRole } from '../telemetry/types.js';
import type { Config } from '../config/config.js';
import { AcpAgentProtocol } from '../agent/acp-agent-protocol.js';
import { AcpProcessManager } from '../agent/acp-process-manager.js';
import { debugLogger } from '../utils/debugLogger.js';

class AsyncQueue<T> {
  private queue: T[] = [];
  private resolvers: Array<(res: IteratorResult<T, void>) => void> = [];
  private done = false;

  push(value: T): void {
    if (this.done) return;
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ value, done: false });
    } else {
      this.queue.push(value);
    }
  }

  finish(): void {
    this.done = true;
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift();
      resolver?.({ value: undefined, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, void> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.done) {
        return;
      } else {
        const next = await new Promise<IteratorResult<T, void>>((resolve) => {
          this.resolvers.push(resolve);
        });
        if (next.done) {
          return;
        }
        yield next.value;
      }
    }
  }
}

export const VALID_ANTIGRAVITY_MODELS = new Set([
  'gemini-3.8-flash-high',
  'gemini-3.8-flash-medium',
  'gemini-3.8-flash-low',
  'claude-sonnet-4-6',
  'claude-opus-4-6-thinking',
  'gpt-oss-120b-medium',
]);

export function normalizeAntigravityModel(model?: string): string {
  if (!model) return 'gemini-3.8-flash-high';
  if (VALID_ANTIGRAVITY_MODELS.has(model)) return model;
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'claude-opus-4-6-thinking';
  if (m.includes('sonnet') || m.includes('claude')) return 'claude-sonnet-4-6';
  if (m.includes('oss') || m.includes('120b')) return 'gpt-oss-120b-medium';
  if (m.includes('low')) return 'gemini-3.8-flash-low';
  if (m.includes('medium')) return 'gemini-3.8-flash-medium';
  return 'gemini-3.8-flash-high';
}

export class AntigravityContentGenerator implements ContentGenerator {
  userTier?: UserTierId;
  userTierName?: string = 'Antigravity';
  private protocol?: AcpAgentProtocol;
  private currentModel?: string;

  constructor(private readonly config?: Config) {}

  private extractPromptText(contents: unknown): string {
    if (typeof contents === 'string') {
      return contents;
    }
    if (Array.isArray(contents) && contents.length > 0) {
      const items: readonly unknown[] = contents;
      const lastContent = items[items.length - 1];
      if (typeof lastContent === 'string') {
        return lastContent;
      }
      if (
        lastContent &&
        typeof lastContent === 'object' &&
        'parts' in lastContent &&
        Array.isArray(lastContent.parts)
      ) {
        const textParts: string[] = [];
        for (const p of lastContent.parts) {
          if (typeof p === 'string') {
            textParts.push(p);
          } else if (
            p &&
            typeof p === 'object' &&
            'text' in p &&
            typeof p.text === 'string'
          ) {
            textParts.push(p.text);
          }
        }
        return textParts.join('\n');
      }
    }
    return '';
  }

  private async getProtocol(
    requestedModel?: string,
  ): Promise<AcpAgentProtocol> {
    const rawModel = requestedModel || this.config?.getModel();
    const targetModel = normalizeAntigravityModel(rawModel);

    if (!this.protocol) {
      const manager = new AcpProcessManager();
      this.protocol = new AcpAgentProtocol(manager, {
        workspaceDir: this.config?.getWorkingDir?.() || process.cwd(),
        getMode: () => this.config?.getApprovalMode?.() || 'default',
      });
      await this.protocol.initialize();
      await this.protocol.setModel(targetModel);
      this.currentModel = targetModel;
    } else if (targetModel !== this.currentModel) {
      await this.protocol.setModel(targetModel);
      this.currentModel = targetModel;
    }
    return this.protocol;
  }

  async generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
    role: LlmRole,
  ): Promise<GenerateContentResponse> {
    debugLogger.debug('AntigravityContentGenerator.generateContent called');
    const isJson =
      request.config?.responseMimeType === 'application/json' ||
      Boolean(request.config?.responseSchema);
    if (isJson) {
      const response = new GenerateContentResponse();
      response.candidates = [
        {
          content: {
            role: 'model',
            parts: [
              {
                text: JSON.stringify({
                  complexity_score: 5,
                  complexity_reasoning: 'Routed to Antigravity Engine',
                }),
              },
            ],
          },
          finishReason: FinishReason.STOP,
        },
      ];
      return response;
    }

    const stream = await this.generateContentStream(
      request,
      userPromptId,
      role,
    );
    let fullText = '';
    for await (const chunk of stream) {
      const parts = chunk.candidates?.[0]?.content?.parts;
      if (parts) {
        for (const p of parts) {
          if (p.text && !p.thought) {
            fullText += p.text;
          }
        }
      }
    }

    const response = new GenerateContentResponse();
    response.candidates = [
      {
        content: {
          role: 'model',
          parts: [{ text: fullText }],
        },
        finishReason: FinishReason.STOP,
      },
    ];
    return response;
  }

  async generateContentStream(
    request: GenerateContentParameters,
    _userPromptId: string,
    _role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    debugLogger.debug(
      'AntigravityContentGenerator.generateContentStream called',
    );
    const isJson =
      request.config?.responseMimeType === 'application/json' ||
      Boolean(request.config?.responseSchema);
    if (isJson) {
      const response = new GenerateContentResponse();
      response.candidates = [
        {
          content: {
            role: 'model',
            parts: [
              {
                text: JSON.stringify({
                  complexity_score: 5,
                  complexity_reasoning: 'Routed to Antigravity Engine',
                }),
              },
            ],
          },
          finishReason: FinishReason.STOP,
        },
      ];
      async function* single() {
        yield response;
      }
      return single();
    }

    const userText = this.extractPromptText(request.contents);
    if (!userText) {
      const response = new GenerateContentResponse();
      response.candidates = [
        {
          content: {
            role: 'model',
            parts: [{ text: 'Gravity Engine Online.' }],
          },
          finishReason: FinishReason.STOP,
        },
      ];
      async function* empty() {
        yield response;
      }
      return empty();
    }

    const queue = new AsyncQueue<GenerateContentResponse>();
    let unsubscribe: (() => void) | undefined;

    try {
      const protocol = await this.getProtocol(request.model);

      unsubscribe = protocol.subscribe((evt) => {
        if (evt.type === 'message' && evt.role === 'agent') {
          for (const part of evt.content) {
            if (part.type === 'text' && part.text) {
              const chunk = new GenerateContentResponse();
              chunk.candidates = [
                {
                  content: {
                    role: 'model',
                    parts: [{ text: part.text }],
                  },
                },
              ];
              queue.push(chunk);
            } else if (part.type === 'thought' && part.thought) {
              const chunk = new GenerateContentResponse();
              chunk.candidates = [
                {
                  content: {
                    role: 'model',
                    parts: [{ text: part.thought, thought: true }],
                  },
                },
              ];
              queue.push(chunk);
            }
          }
        } else if (evt.type === 'agent_end') {
          const finalChunk = new GenerateContentResponse();
          finalChunk.candidates = [
            {
              content: {
                role: 'model',
                parts: [],
              },
              finishReason: FinishReason.STOP,
            },
          ];
          queue.push(finalChunk);
          queue.finish();
        } else if (evt.type === 'error') {
          const errChunk = new GenerateContentResponse();
          errChunk.candidates = [
            {
              content: {
                role: 'model',
                parts: [{ text: `\n[Antigravity Error: ${evt.message}]` }],
              },
              finishReason: FinishReason.STOP,
            },
          ];
          queue.push(errChunk);
          queue.finish();
        }
      });

      await protocol.send({
        message: {
          content: [{ type: 'text', text: userText }],
        },
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errChunk = new GenerateContentResponse();
      errChunk.candidates = [
        {
          content: {
            role: 'model',
            parts: [{ text: `\n[Antigravity Connection Error: ${errMsg}]` }],
          },
          finishReason: FinishReason.STOP,
        },
      ];
      queue.push(errChunk);
      queue.finish();
    }

    async function* stream() {
      try {
        for await (const chunk of queue) {
          yield chunk;
        }
      } finally {
        if (unsubscribe) {
          unsubscribe();
        }
      }
    }

    return stream();
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    const text = this.extractPromptText(request.contents);
    return {
      totalTokens: Math.max(1, Math.ceil(text.length / 4)),
    };
  }

  async embedContent(
    _request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    const response = new EmbedContentResponse();
    response.embeddings = [];
    return response;
  }

  async close(): Promise<void> {
    if (this.protocol) {
      await this.protocol.close();
      this.protocol = undefined;
    }
  }
}
