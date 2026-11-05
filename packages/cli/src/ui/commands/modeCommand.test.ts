/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { modeCommand } from './modeCommand.js';
import { ApprovalMode, coreEvents } from '@google/gemini-cli-core';
import type { CommandContext } from './types.js';

describe('modeCommand', () => {
  let mockConfig: {
    getApprovalMode: ReturnType<typeof vi.fn>;
    setApprovalMode: ReturnType<typeof vi.fn>;
  };
  let mockContext: CommandContext;

  beforeEach(() => {
    mockConfig = {
      getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.DEFAULT),
      setApprovalMode: vi.fn(),
    };
    mockContext = {
      services: {
        agentContext: {
          config: mockConfig as unknown,
        } as unknown,
      } as unknown,
    } as CommandContext;
    vi.spyOn(coreEvents, 'emitFeedback').mockImplementation(() => {});
  });

  it('switches to plan mode', async () => {
    await modeCommand.action!(mockContext, 'plan');
    expect(mockConfig.setApprovalMode).toHaveBeenCalledWith(ApprovalMode.PLAN);
    expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
      'info',
      expect.stringContaining('Plan Mode'),
    );
  });

  it('switches to accept-edits mode', async () => {
    await modeCommand.action!(mockContext, 'accept-edits');
    expect(mockConfig.setApprovalMode).toHaveBeenCalledWith(
      ApprovalMode.AUTO_EDIT,
    );
    expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
      'info',
      expect.stringContaining('Accept Edits Mode'),
    );
  });

  it('switches to default mode', async () => {
    await modeCommand.action!(mockContext, 'default');
    expect(mockConfig.setApprovalMode).toHaveBeenCalledWith(
      ApprovalMode.DEFAULT,
    );
    expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
      'info',
      expect.stringContaining('Default Mode'),
    );
  });

  it('reports error on unknown mode', async () => {
    await modeCommand.action!(mockContext, 'invalid-mode');
    expect(mockConfig.setApprovalMode).not.toHaveBeenCalled();
    expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('Unknown mode: "invalid-mode"'),
    );
  });
});
