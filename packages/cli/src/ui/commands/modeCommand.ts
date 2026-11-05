/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import { CommandKind, type SlashCommand } from './types.js';
import { ApprovalMode, coreEvents } from '@google/gemini-cli-core';

export const modeCommand: SlashCommand = {
  name: 'mode',
  description:
    'Switch agent execution mode: plan (read-only), accept-edits (auto-apply), or default',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context, args): Promise<void> => {
    const config = context.services.agentContext?.config;
    if (!config) return;

    const trimmed = (args || '').trim().toLowerCase();
    if (!trimmed) {
      const current = config.getApprovalMode();
      coreEvents.emitFeedback(
        'info',
        `Current execution mode: ${current}\nAvailable modes: plan (read-only), accept-edits (auto-apply edits), default (prompt for approvals)`,
      );
      return;
    }

    if (trimmed === 'plan') {
      config.setApprovalMode(ApprovalMode.PLAN);
      coreEvents.emitFeedback(
        'info',
        'Switched to Plan Mode (read-only). Write tools will be rejected.',
      );
      return;
    }

    if (
      trimmed === 'accept-edits' ||
      trimmed === 'acceptedits' ||
      trimmed === 'autoedit' ||
      trimmed === 'auto_edit'
    ) {
      config.setApprovalMode(ApprovalMode.AUTO_EDIT);
      coreEvents.emitFeedback(
        'info',
        'Switched to Accept Edits Mode (auto-approve file changes).',
      );
      return;
    }

    if (trimmed === 'default') {
      config.setApprovalMode(ApprovalMode.DEFAULT);
      coreEvents.emitFeedback(
        'info',
        'Switched to Default Mode (prompt for approvals).',
      );
      return;
    }

    if (trimmed === 'yolo') {
      config.setApprovalMode(ApprovalMode.YOLO);
      coreEvents.emitFeedback(
        'info',
        'Switched to YOLO Mode (auto-approve all actions).',
      );
      return;
    }

    coreEvents.emitFeedback(
      'error',
      `Unknown mode: "${trimmed}". Available modes: plan, accept-edits, default, yolo`,
    );
  },
};
