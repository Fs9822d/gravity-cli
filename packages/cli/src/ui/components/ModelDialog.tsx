/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Modifications Copyright 2026 Gravity Project Maintainers
 * Licensed under the Apache License, Version 2.0
 */

import type React from 'react';
import { useCallback, useContext, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { ModelQuotaDisplay } from './ModelQuotaDisplay.js';
import { useUIState } from '../contexts/UIStateContext.js';
import {
  ModelSlashCommandEvent,
  logModelSlashCommand,
  AuthType,
} from '@google/gemini-cli-core';
import { useKeypress } from '../hooks/useKeypress.js';
import { theme } from '../semantic-colors.js';
import { DescriptiveRadioButtonSelect } from './shared/DescriptiveRadioButtonSelect.js';
import { ConfigContext } from '../contexts/ConfigContext.js';
import { useSettings } from '../contexts/SettingsContext.js';
import {
  ANTIGRAVITY_MODELS,
  GOOGLE_AI_API_MODELS,
} from '../commands/modelCommand.js';

interface ModelDialogProps {
  onClose: () => void;
}

export function ModelDialog({ onClose }: ModelDialogProps): React.JSX.Element {
  const config = useContext(ConfigContext);
  const settings = useSettings();
  const { terminalWidth } = useUIState();
  const [persistMode, setPersistMode] = useState(false);

  // Determine the Preferred Model
  const preferredModel = config?.getModel() || '';

  const selectedAuthType =
    settings.merged.security.auth.selectedType ||
    config?.getContentGeneratorConfig()?.authType;
  const isGoogleAi = selectedAuthType === AuthType.USE_GEMINI;

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onClose();
        return true;
      }
      if (key.name === 'tab') {
        setPersistMode((prev) => !prev);
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  const options = useMemo(() => {
    const list = isGoogleAi ? GOOGLE_AI_API_MODELS : ANTIGRAVITY_MODELS;
    return list.map((m) => ({
      value: m.id,
      title: m.name,
      description: m.description,
      key: m.id,
    }));
  }, [isGoogleAi]);

  // Calculate the initial index based on the preferred model.
  const initialIndex = useMemo(() => {
    const idx = options.findIndex((option) => option.value === preferredModel);
    return idx !== -1 ? idx : 0;
  }, [preferredModel, options]);

  // Handle selection internally
  const handleSelect = useCallback(
    (model: string) => {
      if (config) {
        config.setModel(model, persistMode ? false : true);
        const event = new ModelSlashCommandEvent(model);
        logModelSlashCommand(config, event);
      }
      onClose();
    },
    [config, onClose, persistMode],
  );

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border.default}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold>
        {isGoogleAi
          ? 'Select Google AI Model (API Key Mode)'
          : 'Select Native Antigravity Model'}
      </Text>

      <Box marginTop={1}>
        <DescriptiveRadioButtonSelect
          items={options}
          onSelect={handleSelect}
          initialIndex={initialIndex}
          showNumbers={true}
        />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text bold color={theme.text.primary}>
            Remember model for future sessions:{' '}
          </Text>
          <Text color={theme.status.success}>
            {persistMode ? 'true' : 'false'}
          </Text>
          <Text color={theme.text.secondary}> (Press Tab to toggle)</Text>
        </Box>
      </Box>
      <Box flexDirection="column">
        <Text color={theme.text.secondary}>
          {isGoogleAi
            ? '> To use a specific Google AI model on startup, use the --model flag.'
            : '> To use a specific Antigravity model on startup, use the --model flag.'}
        </Text>
      </Box>
      <ModelQuotaDisplay
        buckets={config?.getLastRetrievedQuota()?.buckets}
        availableWidth={terminalWidth - 2}
      />
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.text.secondary}>(Press Esc to close)</Text>
      </Box>
    </Box>
  );
}
