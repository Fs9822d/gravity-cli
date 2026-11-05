/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Modifications Copyright 2026 Gravity Project Maintainers
 * Licensed under the Apache License, Version 2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { ModelDialog } from './ModelDialog.js';
import { renderWithProviders } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { createMockSettings } from '../../test-utils/settings.js';
import { AuthType } from '@google/gemini-cli-core';
import type { Config, ModelSlashCommandEvent } from '@google/gemini-cli-core';

const mockLogModelSlashCommand = vi.fn();
const mockModelSlashCommandEvent = vi.fn();

vi.mock('@google/gemini-cli-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@google/gemini-cli-core')>();
  return {
    ...actual,
    logModelSlashCommand: (config: Config, event: ModelSlashCommandEvent) =>
      mockLogModelSlashCommand(config, event),
    ModelSlashCommandEvent: class {
      constructor(model: string) {
        mockModelSlashCommandEvent(model);
      }
    },
  };
});

describe('<ModelDialog />', () => {
  const mockSetModel = vi.fn();
  const mockGetModel = vi.fn();
  const mockOnClose = vi.fn();

  interface MockConfig {
    setModel: (model: string, isTemporary?: boolean) => void;
    getModel: () => string;
    getContentGeneratorConfig: () => { authType?: AuthType };
    getSessionId: () => string;
    getIdeMode: () => boolean;
    getProModelNoAccessSync: () => boolean;
    getProModelNoAccess: () => Promise<boolean>;
    getHasAccessToPreviewModel: () => boolean;
    getGemini31LaunchedSync: () => boolean;
    getExperimentalGemma: () => boolean;
    getLastRetrievedQuota: () =>
      | {
          buckets: Array<{
            modelId?: string;
            remainingFraction?: number;
            resetTime?: string;
          }>;
        }
      | undefined;
  }

  const mockConfig: MockConfig = {
    setModel: mockSetModel,
    getModel: mockGetModel,
    getContentGeneratorConfig: () => ({ authType: AuthType.LOGIN_WITH_GOOGLE }),
    getSessionId: () => 'test-session-id',
    getIdeMode: () => false,
    getProModelNoAccessSync: () => false,
    getProModelNoAccess: async () => false,
    getHasAccessToPreviewModel: () => true,
    getGemini31LaunchedSync: () => false,
    getExperimentalGemma: () => false,
    getLastRetrievedQuota: () => ({ buckets: [] }),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockGetModel.mockReturnValue('gemini-3.8-flash-high');
  });

  const renderComponent = async (
    configValue = mockConfig as unknown as Config,
    authType = AuthType.LOGIN_WITH_GOOGLE,
  ) => {
    const settings = createMockSettings({
      security: {
        auth: {
          selectedType: authType,
        },
      },
    });

    return renderWithProviders(<ModelDialog onClose={mockOnClose} />, {
      config: configValue,
      settings,
    });
  };

  describe('Native Antigravity Mode (Default / OAuth)', () => {
    it('renders native Antigravity models in the dialog', async () => {
      const { lastFrame, unmount } = await renderComponent();
      const output = lastFrame();
      expect(output).toContain('Select Native Antigravity Model');
      expect(output).toContain('Gemini 3.8 Flash (High)');
      expect(output).toContain('Gemini 3.8 Flash (Medium)');
      expect(output).toContain('Gemini 3.8 Flash (Low)');
      expect(output).toContain('Claude Sonnet 4.6 (Thinking)');
      expect(output).toContain('Claude Opus 4.6 (Thinking)');
      expect(output).toContain('GPT-OSS 120B (Medium)');
      unmount();
    });

    it('sets the selected Antigravity model and closes on Enter', async () => {
      const { stdin, waitUntilReady, unmount } = await renderComponent();

      // Press Enter on the first item (gemini-3.8-flash-high)
      await act(async () => {
        stdin.write('\r');
      });
      await waitUntilReady();

      await waitFor(() => {
        expect(mockSetModel).toHaveBeenCalledWith(
          'gemini-3.8-flash-high',
          true,
        );
        expect(mockOnClose).toHaveBeenCalled();
      });
      unmount();
    });
  });

  describe('Google AI API Mode (GEMINI_API_KEY)', () => {
    it('renders extended Google AI API models when in USE_GEMINI auth mode', async () => {
      mockGetModel.mockReturnValue('gemini-2.5-pro');
      const { lastFrame, unmount } = await renderComponent(
        mockConfig as unknown as Config,
        AuthType.USE_GEMINI,
      );

      const output = lastFrame();
      expect(output).toContain('Select Google AI Model (API Key Mode)');
      expect(output).toContain('Gemini 2.5 Pro');
      expect(output).toContain('Gemini 2.5 Flash');
      expect(output).toContain('Gemini 2.5 Flash Lite');
      expect(output).toContain('Gemini 3.0 Preview');
      expect(output).toContain('Auto (Model Router)');
      unmount();
    });

    it('sets the selected Google AI model and closes on Enter', async () => {
      mockGetModel.mockReturnValue('gemini-2.5-pro');
      const { stdin, waitUntilReady, unmount } = await renderComponent(
        mockConfig as unknown as Config,
        AuthType.USE_GEMINI,
      );

      await act(async () => {
        stdin.write('\r');
      });
      await waitUntilReady();

      await waitFor(() => {
        expect(mockSetModel).toHaveBeenCalledWith('gemini-2.5-pro', true);
        expect(mockOnClose).toHaveBeenCalled();
      });
      unmount();
    });
  });

  describe('Dialog Controls', () => {
    it('toggles persist mode with Tab key', async () => {
      const { lastFrame, stdin, waitUntilReady, unmount } =
        await renderComponent();

      expect(lastFrame()).toContain(
        'Remember model for future sessions: false',
      );

      await act(async () => {
        stdin.write('\t');
      });
      await waitUntilReady();

      await waitFor(() => {
        expect(lastFrame()).toContain(
          'Remember model for future sessions: true',
        );
      });

      // Press Enter with persistMode = true
      await act(async () => {
        stdin.write('\r');
      });
      await waitUntilReady();

      await waitFor(() => {
        expect(mockSetModel).toHaveBeenCalledWith(
          'gemini-3.8-flash-high',
          false,
        );
        expect(mockOnClose).toHaveBeenCalled();
      });
      unmount();
    });

    it('closes dialog on Escape key', async () => {
      const { stdin, waitUntilReady, unmount } = await renderComponent();

      await act(async () => {
        stdin.write('\u001B'); // Escape
      });
      await act(async () => {
        await waitUntilReady();
      });

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
      unmount();
    });
  });
});
