/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { RadioButtonSelect } from '../components/shared/RadioButtonSelect.js';
import {
  SettingScope,
  type LoadableSettingScope,
  type LoadedSettings,
} from '../../config/settings.js';
import { AuthType, type Config } from '@google/gemini-cli-core';
import { useKeypress } from '../hooks/useKeypress.js';
import { AuthState } from '../types.js';
import { validateAuthMethodWithSettings } from './useAuth.js';

interface AuthDialogProps {
  config: Config;
  settings: LoadedSettings;
  setAuthState: (state: AuthState) => void;
  authError: string | null;
  onAuthError: (error: string | null) => void;
  setAuthContext: (context: { requiresRestart?: boolean }) => void;
}

export function AuthDialog({
  config: _config,
  settings,
  setAuthState,
  authError,
  onAuthError,
  setAuthContext,
}: AuthDialogProps): React.JSX.Element {
  let items = [
    {
      label: '1. Google AI OAuth Flow (Personal / Workspace)',
      value: AuthType.LOGIN_WITH_GOOGLE,
      key: AuthType.LOGIN_WITH_GOOGLE,
    },
    {
      label: '2. Google AI API (GEMINI_API_KEY)',
      value: AuthType.USE_GEMINI,
      key: AuthType.USE_GEMINI,
    },
  ];

  if (settings.merged.security.auth.enforcedType) {
    items = items.filter(
      (item) => item.value === settings.merged.security.auth.enforcedType,
    );
  }

  let defaultAuthType: AuthType | null = null;
  const defaultAuthTypeEnv = process.env['GEMINI_DEFAULT_AUTH_TYPE'];
  if (
    defaultAuthTypeEnv &&
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    Object.values(AuthType).includes(defaultAuthTypeEnv as AuthType)
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    defaultAuthType = defaultAuthTypeEnv as AuthType;
  }

  let initialAuthIndex = items.findIndex((item) => {
    if (settings.merged.security.auth.selectedType) {
      return item.value === settings.merged.security.auth.selectedType;
    }

    if (defaultAuthType) {
      return item.value === defaultAuthType;
    }

    if (process.env['GEMINI_API_KEY']) {
      return item.value === AuthType.USE_GEMINI;
    }

    return item.value === AuthType.LOGIN_WITH_GOOGLE;
  });
  if (settings.merged.security.auth.enforcedType) {
    initialAuthIndex = 0;
  }

  const onSelect = useCallback(
    async (authType: AuthType | undefined, scope: LoadableSettingScope) => {
      if (authType) {
        const needsRestart =
          authType === AuthType.LOGIN_WITH_GOOGLE ||
          (authType === AuthType.USE_VERTEX_AI &&
            process.env['CLOUD_SHELL'] === 'true');

        if (needsRestart) {
          setAuthContext({ requiresRestart: true });
        } else {
          setAuthContext({});
        }

        settings.setValue(scope, 'security.auth.selectedType', authType);

        if (authType === AuthType.LOGIN_WITH_GOOGLE) {
          setAuthState(AuthState.Authenticated);
          return;
        }

        if (authType === AuthType.USE_GEMINI) {
          // Always show the API key input dialog so the user can
          // explicitly enter or confirm their key, regardless of
          // whether GEMINI_API_KEY env var or a stored key exists.
          setAuthState(AuthState.AwaitingApiKeyInput);
          return;
        }
      }
      setAuthState(AuthState.Unauthenticated);
    },
    [settings, setAuthState, setAuthContext],
  );

  const handleAuthSelect = async (authMethod: AuthType) => {
    const error = await validateAuthMethodWithSettings(
      authMethod,
      settings,
    ).catch((e) => (e instanceof Error ? e.message : String(e)));
    if (error) {
      onAuthError(error);
    } else {
      onAuthError(null);
      try {
        await onSelect(authMethod, SettingScope.User);
      } catch (e) {
        onAuthError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        // Prevent exit if there is an error message.
        // This means they user is not authenticated yet.
        if (authError) {
          return true;
        }
        if (settings.merged.security.auth.selectedType === undefined) {
          // Prevent exiting if no auth method is set
          onAuthError(
            'You must select an auth method to proceed. Press Ctrl+C twice to exit.',
          );
          return true;
        }
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        onSelect(undefined, SettingScope.User);
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  return (
    <Box
      borderStyle="round"
      borderColor={theme.ui.focus}
      flexDirection="row"
      padding={1}
      width="100%"
      alignItems="flex-start"
    >
      <Text color={theme.text.accent}>? </Text>
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color={theme.text.primary}>
          Get started
        </Text>
        <Box marginTop={1}>
          <Text color={theme.text.primary}>
            How would you like to authenticate for this project?
          </Text>
        </Box>
        <Box marginTop={1}>
          <RadioButtonSelect
            items={items}
            initialIndex={initialAuthIndex}
            onSelect={handleAuthSelect}
            onHighlight={() => {
              onAuthError(null);
            }}
          />
        </Box>
        {authError && (
          <Box marginTop={1}>
            <Text color={theme.status.error}>{authError}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>(Use Enter to select)</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.text.primary}>
            Terms of Services and Notice for Gravity Harness
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.text.link}>
            {'https://geminicli.com/docs/resources/tos-privacy/'}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
