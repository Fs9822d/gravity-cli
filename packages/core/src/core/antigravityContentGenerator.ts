/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type GenerateContentResponse,
  type CountTokensResponse,
  type GenerateContentParameters,
  type CountTokensParameters,
  EmbedContentResponse,
  type EmbedContentParameters,
} from '@google/genai';
import type { ContentGenerator } from './contentGenerator.js';
import type { UserTierId } from '../code_assist/types.js';
import type { LlmRole } from '../telemetry/types.js';
import type { Config } from '../config/config.js';

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

/**
 * @deprecated Antigravity integration now runs directly through `AcpAgentProtocol`.
 * `AntigravityContentGenerator` is deprecated and decoupled from the content generator factory.
 */
export class AntigravityContentGenerator implements ContentGenerator {
  userTier?: UserTierId;
  userTierName?: string = 'Antigravity';

  constructor(protected readonly _config?: Config) {}

  async generateContent(
    _request: GenerateContentParameters,
    _userPromptId: string,
    _role: LlmRole,
  ): Promise<GenerateContentResponse> {
    throw new Error(
      'AntigravityContentGenerator is deprecated. Antigravity sessions run directly through AcpAgentProtocol.',
    );
  }

  async generateContentStream(
    _request: GenerateContentParameters,
    _userPromptId: string,
    _role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    throw new Error(
      'AntigravityContentGenerator is deprecated. Antigravity sessions run directly through AcpAgentProtocol.',
    );
  }

  async countTokens(
    _request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    throw new Error(
      'AntigravityContentGenerator is deprecated. Token usage is reported via native ACP usage_update events.',
    );
  }

  async embedContent(
    _request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    const response = new EmbedContentResponse();
    response.embeddings = [];
    return response;
  }
}
