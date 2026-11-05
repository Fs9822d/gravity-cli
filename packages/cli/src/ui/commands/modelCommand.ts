/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Modifications Copyright 2026 Gravity Project Maintainers
 * Licensed under the Apache License, Version 2.0
 */

import {
  ModelSlashCommandEvent,
  logModelSlashCommand,
  AuthType,
} from '@google/gemini-cli-core';
import {
  type CommandContext,
  CommandKind,
  type SlashCommand,
} from './types.js';
import { MessageType } from '../types.js';

export const ANTIGRAVITY_MODELS = [
  {
    id: 'gemini-3.8-flash-high',
    name: 'Gemini 3.8 Flash (High)',
    description:
      'Gemini 3.8 Flash with high reasoning effort for complex engineering.',
  },
  {
    id: 'gemini-3.8-flash-medium',
    name: 'Gemini 3.8 Flash (Medium)',
    description:
      'Gemini 3.8 Flash with balanced reasoning effort for standard tasks.',
  },
  {
    id: 'gemini-3.8-flash-low',
    name: 'Gemini 3.8 Flash (Low)',
    description:
      'Gemini 3.8 Flash with low reasoning effort for high-speed agent loops.',
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6 (Thinking)',
    description: 'Anthropic Claude Sonnet 4.6 with deep thinking capabilities.',
  },
  {
    id: 'claude-opus-4-6-thinking',
    name: 'Claude Opus 4.6 (Thinking)',
    description: 'Anthropic Claude Opus 4.6 flagship deep reasoning model.',
  },
  {
    id: 'gpt-oss-120b-medium',
    name: 'GPT-OSS 120B (Medium)',
    description: 'Open-weight 120B model with medium reasoning effort.',
  },
];

export const GOOGLE_AI_API_MODELS = [
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    description:
      'Advanced reasoning and complex multi-file coding with 1M+ context window.',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description:
      'High-speed, cost-effective multimodal model for fast iterative loops.',
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    description:
      'Ultra-low-latency lightweight model for high-frequency commands.',
  },
  {
    id: 'gemini-3.0-preview',
    name: 'Gemini 3.0 Preview',
    description:
      'Next-generation preview model showcasing cutting-edge capabilities.',
  },
  {
    id: 'auto',
    name: 'Auto (Model Router)',
    description:
      'Dynamically routes each request between Pro and Flash based on prompt complexity.',
  },
];

const listModelCommand: SlashCommand = {
  name: 'list',
  description: 'List available models for current mode',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (context: CommandContext) => {
    const authType =
      context.services.settings?.merged?.security?.auth?.selectedType ||
      context.services.agentContext?.config?.getContentGeneratorConfig()
        ?.authType;
    const isGoogleAi = authType === AuthType.USE_GEMINI;

    const models = isGoogleAi ? GOOGLE_AI_API_MODELS : ANTIGRAVITY_MODELS;
    const title = isGoogleAi
      ? 'Available Google AI API Models:'
      : 'Available Antigravity Models:';

    let output = `${title}\n\n`;
    for (const m of models) {
      output += `  • ${m.id} (${m.name})\n    ${m.description}\n\n`;
    }
    output += 'Use /model set <model-name> to switch models.';
    context.ui.addItem({
      type: MessageType.INFO,
      text: output,
    });
  },
};

const setModelCommand: SlashCommand = {
  name: 'set',
  description:
    'Set the model to use. Usage: /model set <model-name> [--persist]',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (context: CommandContext, args: string) => {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      context.ui.addItem({
        type: MessageType.ERROR,
        text: 'Usage: /model set <model-name> [--persist]',
      });
      return;
    }

    const modelName = parts[0];
    const persist = parts.includes('--persist');

    if (context.services.agentContext?.config) {
      context.services.agentContext.config.setModel(modelName, !persist);
      const event = new ModelSlashCommandEvent(modelName);
      logModelSlashCommand(context.services.agentContext.config, event);

      context.ui.addItem({
        type: MessageType.INFO,
        text: `Model set to ${modelName}${persist ? ' (persisted)' : ''}`,
      });
    }
  },
};

const manageModelCommand: SlashCommand = {
  name: 'manage',
  description: 'Opens a dialog to configure the model',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context: CommandContext) => {
    if (context.services.agentContext?.config) {
      await context.services.agentContext.config.refreshUserQuota();
    }
    return {
      type: 'dialog',
      dialog: 'model',
    };
  },
};

export const modelCommand: SlashCommand = {
  name: 'model',
  description: 'Manage model configuration',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  subCommands: [manageModelCommand, setModelCommand, listModelCommand],
  action: async (context: CommandContext, args: string) => {
    const trimmed = args.trim();
    if (trimmed === 'list') {
      return listModelCommand.action!(context, trimmed);
    }
    if (trimmed.startsWith('set ')) {
      return setModelCommand.action!(context, trimmed.slice(4));
    }
    return manageModelCommand.action!(context, args);
  },
};
