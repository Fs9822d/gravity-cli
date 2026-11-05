/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Modifications Copyright 2026 Gravity Project Maintainers
 * Licensed under the Apache License, Version 2.0
 */

import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import commandExists from 'command-exists';

export interface AcpProcessManagerOptions {
  antigravityPath?: string;
  sandbox?: boolean;
  appDataDir?: string;
  geminiDir?: string;
  env?: NodeJS.ProcessEnv;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  model?: string;
  dangerouslySkipPermissions?: boolean;
}

const activeManagers = new Set<AcpProcessManager>();
let globalCleanupsRegistered = false;

function ensureGlobalCleanupsRegistered(): void {
  if (globalCleanupsRegistered) return;
  globalCleanupsRegistered = true;

  const cleanupAll = () => {
    for (const manager of activeManagers) {
      manager.stopSync();
    }
  };

  process.once('exit', cleanupAll);
  process.once('SIGINT', cleanupAll);
  process.once('SIGTERM', cleanupAll);
}

export class AcpProcessManager {
  private currentProcess?: ChildProcess;

  constructor(private readonly options: AcpProcessManagerOptions = {}) {
    activeManagers.add(this);
    ensureGlobalCleanupsRegistered();
  }

  /**
   * Resolves the path to the Antigravity (agy) executable.
   * Priority:
   * 1. explicit options.antigravityPath
   * 2. GRAVITY_AGY_PATH env var
   * 3. ~/.local/bin/agy
   * 4. agy on PATH
   * 5. ~/.local/bin/antigravity
   * 6. antigravity on PATH
   */
  findAgyExecutable(): string {
    if (this.options.antigravityPath) {
      return this.options.antigravityPath;
    }

    if (
      process.env['GRAVITY_AGY_PATH'] &&
      fs.existsSync(process.env['GRAVITY_AGY_PATH'])
    ) {
      return process.env['GRAVITY_AGY_PATH'];
    }

    const homeLocalBinAgy = path.join(os.homedir(), '.local', 'bin', 'agy');
    if (fs.existsSync(homeLocalBinAgy)) {
      return homeLocalBinAgy;
    }

    if (commandExists.sync('agy')) {
      return 'agy';
    }

    const homeLocalBinAntigravity = path.join(
      os.homedir(),
      '.local',
      'bin',
      'antigravity',
    );
    if (fs.existsSync(homeLocalBinAntigravity)) {
      return homeLocalBinAntigravity;
    }

    if (commandExists.sync('antigravity')) {
      return 'antigravity';
    }

    // Default fallback
    return 'agy';
  }

  /**
   * Spawns the `agy acp` server process over stdio.
   */
  async spawn(workspaceDir?: string): Promise<ChildProcess> {
    if (
      this.currentProcess &&
      !this.currentProcess.killed &&
      this.currentProcess.exitCode === null
    ) {
      return this.currentProcess;
    }

    const executable = this.findAgyExecutable();
    const args: string[] = [];

    // Top-level agy CLI flags (must precede 'acp' subcommand)
    if (this.options.effort) {
      args.push('--effort', this.options.effort);
    }

    if (this.options.model) {
      args.push('--model', this.options.model);
    }

    args.push('acp', '--stdio');

    // Subcommand flags for 'acp'
    if (this.options.sandbox) {
      args.push('--sandbox');
    }

    if (workspaceDir) {
      args.push('--add-dir', workspaceDir);
    }

    if (this.options.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    // Construct execution environment
    // Ensure HOME is writable if running in sandboxes where os.homedir() is read-only
    const childEnv = { ...process.env, ...this.options.env };
    try {
      fs.accessSync(os.homedir(), fs.constants.W_OK);
    } catch {
      // In read-only home directories, fallback HOME to a writable temporary directory
      const tmpHome = path.join(os.tmpdir(), 'gravity-home');
      try {
        fs.mkdirSync(tmpHome, { recursive: true });
        childEnv['HOME'] = tmpHome;
      } catch {
        childEnv['HOME'] = os.tmpdir();
      }
    }

    const child = spawn(executable, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: workspaceDir || process.cwd(),
      env: childEnv,
    });

    this.currentProcess = child;

    child.on('error', () => {
      // Allow caller to inspect process errors
    });

    child.on('exit', () => {
      if (this.currentProcess === child) {
        this.currentProcess = undefined;
      }
    });

    return child;
  }

  /**
   * Terminate active child process gracefully.
   */
  async stop(): Promise<void> {
    activeManagers.delete(this);
    if (
      !this.currentProcess ||
      this.currentProcess.killed ||
      this.currentProcess.exitCode !== null
    ) {
      this.currentProcess = undefined;
      return;
    }

    const proc = this.currentProcess;
    this.currentProcess = undefined;

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          if (!proc.killed && proc.exitCode === null) {
            proc.kill('SIGKILL');
          }
        } catch {
          // ignore
        }
        resolve();
      }, 1500);

      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });

      try {
        proc.kill('SIGINT');
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  stopSync(): void {
    activeManagers.delete(this);
    if (
      this.currentProcess &&
      !this.currentProcess.killed &&
      this.currentProcess.exitCode === null
    ) {
      try {
        this.currentProcess.kill('SIGKILL');
      } catch {
        // ignore
      }
      this.currentProcess = undefined;
    }
  }

  /**
   * Spawns 'agy acp --login' interactively with stdio inherited,
   * allowing the user to complete Google OAuth directly from the terminal.
   */
  async runLogin(): Promise<number> {
    const agyBin = this.findAgyExecutable();
    if (!agyBin) {
      throw new Error(
        'Cannot perform OAuth login: Antigravity executable (agy) was not found in $PATH or ~/.local/bin/agy.',
      );
    }
    return new Promise<number>((resolve, reject) => {
      const child = spawn(agyBin, ['acp', '--login'], {
        stdio: 'inherit',
        env: { ...process.env, ...this.options.env },
      });
      child.on('error', reject);
      child.on('close', (code) => {
        resolve(code ?? 0);
      });
    });
  }
}
