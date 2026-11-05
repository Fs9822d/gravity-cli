/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable no-console */

import type { CommandModule } from 'yargs';
import { AcpProcessManager } from '@google/gemini-cli-core';

export const loginCommand: CommandModule = {
  command: 'login',
  aliases: ['auth'],
  describe: 'Log in with Google OAuth for Antigravity backend',
  handler: async () => {
    try {
      console.log('\nStarting Antigravity Google OAuth sign-in flow...');
      const procMgr = new AcpProcessManager();
      const exitCode = await procMgr.runLogin();
      if (exitCode === 0) {
        console.log(
          '\nSuccessfully authenticated with Google! You can now run "gravity".\n',
        );
      } else {
        console.error(`\nLogin exited with code: ${exitCode}\n`);
      }
      process.exit(exitCode);
    } catch (error) {
      console.error(
        '\nLogin error:',
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    }
  },
};
