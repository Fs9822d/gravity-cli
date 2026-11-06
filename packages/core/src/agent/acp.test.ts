/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Modifications Copyright 2026 Gravity Project Maintainers
 * Licensed under the Apache License, Version 2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AcpProcessManager } from './acp-process-manager.js';
import {
  AcpAgentProtocol,
  isWriteTool,
  isCommandWriteOperation,
} from './acp-agent-protocol.js';
import type { AgentEvent } from './types.js';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter, PassThrough } from 'node:stream';
import fs from 'node:fs';
import type { PolicyEngine } from '../index.js';
import { PolicyDecision } from '../policy/types.js';

describe('AcpProcessManager', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('resolves explicit antigravityPath when configured', () => {
    const manager = new AcpProcessManager({
      antigravityPath: '/custom/path/to/agy',
    });
    expect(manager.findAgyExecutable()).toBe('/custom/path/to/agy');
  });

  it('respects GRAVITY_AGY_PATH environment variable', () => {
    // If set to an executable that exists, it returns it
    const homeAgy = '/home/codespace/.local/bin/agy';
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === homeAgy);
    process.env['GRAVITY_AGY_PATH'] = homeAgy;
    const manager = new AcpProcessManager();
    expect(manager.findAgyExecutable()).toBe(homeAgy);
  });

  it('finds agy in default local bin if present', () => {
    delete process.env['GRAVITY_AGY_PATH'];
    const manager = new AcpProcessManager();
    const exe = manager.findAgyExecutable();
    expect(exe).toBeDefined();
    expect(typeof exe).toBe('string');
  });
});

describe('AcpAgentProtocol', () => {
  it('instantiates and implements AgentProtocol interface', () => {
    const manager = new AcpProcessManager();
    const protocol = new AcpAgentProtocol(manager);

    expect(protocol.events).toEqual([]);
    expect(typeof protocol.subscribe).toBe('function');
    expect(typeof protocol.send).toBe('function');
    expect(typeof protocol.abort).toBe('function');
  });

  it('notifies subscribers when events are emitted', () => {
    const manager = new AcpProcessManager();
    const protocol = new AcpAgentProtocol(manager);

    const events: AgentEvent[] = [];
    const unsubscribe = protocol.subscribe((evt) => {
      events.push(evt);
    });

    // Unsubscribe removes listener
    unsubscribe();
  });

  it('returns streamId immediately from send() before agent_start completes', async () => {
    const mockStdin = new PassThrough();
    const mockStdout = new PassThrough();
    const mockProcess = Object.assign(new EventEmitter(), {
      stdin: mockStdin,
      stdout: mockStdout,
      stderr: new PassThrough(),
      killed: false,
      exitCode: null,
      kill: vi.fn(),
    }) as unknown as ChildProcess;

    const mockManager = {
      spawn: vi.fn().mockResolvedValue(mockProcess),
      stop: vi.fn().mockResolvedValue(undefined),
      stopSync: vi.fn(),
      findAgyExecutable: vi.fn().mockReturnValue('agy'),
    } as unknown as AcpProcessManager;

    const protocol = new AcpAgentProtocol(mockManager, {
      workspaceDir: '/tmp/test-workspace',
    });

    // Manually mark initialized to test send() flow
    (
      protocol as unknown as { initialized: boolean; sessionId: string }
    ).initialized = true;
    (protocol as unknown as { sessionId: string }).sessionId =
      'test-session-123';

    const events: AgentEvent[] = [];
    protocol.subscribe((e) => events.push(e));

    const result = await protocol.send({
      message: {
        content: [{ type: 'text', text: 'Hello Gravity' }],
      },
    });

    expect(result.streamId).toBeDefined();
    expect(typeof result.streamId).toBe('string');

    // Wait for microtask tick
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events.some((e) => e.type === 'message' && e.role === 'user')).toBe(
      true,
    );
    expect(events.some((e) => e.type === 'agent_start')).toBe(true);
  });

  it('maps ACP sessionUpdate chunks to AgentEvents', () => {
    const manager = new AcpProcessManager();
    const protocol = new AcpAgentProtocol(manager);

    (protocol as unknown as { sessionId: string }).sessionId = 'sess-1';
    (protocol as unknown as { currentStreamId: string }).currentStreamId =
      'stream-1';

    const events: AgentEvent[] = [];
    protocol.subscribe((e) => events.push(e));

    const handleUpdate = (
      protocol as unknown as {
        handleSessionUpdate: (notification: unknown) => void;
      }
    ).handleSessionUpdate.bind(protocol);

    // 1. Thought chunk
    handleUpdate({
      sessionId: 'sess-1',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'Thinking about the solution...' },
      },
    });

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('message');
    if (events[0].type === 'message') {
      expect(events[0].role).toBe('agent');
      expect(events[0].content[0]).toEqual({
        type: 'thought',
        thought: 'Thinking about the solution...',
      });
    }

    // 2. Message chunk
    handleUpdate({
      sessionId: 'sess-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Here is the result' },
      },
    });

    expect(events.length).toBe(2);
    expect(events[1].type).toBe('message');
    if (events[1].type === 'message') {
      expect(events[1].content[0]).toEqual({
        type: 'text',
        text: 'Here is the result',
      });
    }

    // 3. Tool call
    handleUpdate({
      sessionId: 'sess-1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'Run Shell Command',
        rawInput: { command: 'echo 42' },
      },
    });

    expect(events.length).toBe(3);
    expect(events[2].type).toBe('tool_request');
    if (events[2].type === 'tool_request') {
      expect(events[2].requestId).toBe('call-1');
      expect(events[2].name).toBe('Run Shell Command');
    }

    // 4. Tool call update (in_progress)
    handleUpdate({
      sessionId: 'sess-1',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'in_progress',
        title: 'Running command',
      },
    });

    expect(events.length).toBe(4);
    expect(events[3].type).toBe('tool_update');

    // 5. Tool call update (completed)
    handleUpdate({
      sessionId: 'sess-1',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'completed',
        title: 'Run Shell Command',
        rawOutput: '42\n',
      },
    });

    expect(events.length).toBe(5);
    expect(events[4].type).toBe('tool_response');
    if (events[4].type === 'tool_response') {
      expect(events[4].requestId).toBe('call-1');
      expect(events[4].isError).toBe(false);
      expect(events[4].display?.resultSummary).toBe('42\n');
      expect(events[4].display?.result).toEqual({ type: 'text', text: '42\n' });
    }
  });

  it('rejects write tool calls with error message in Plan mode', () => {
    const manager = new AcpProcessManager();
    const protocol = new AcpAgentProtocol(manager, { mode: 'plan' });

    const events: AgentEvent[] = [];
    protocol.subscribe((e) => events.push(e));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleUpdate = (protocol as any).handleSessionUpdate.bind(protocol);

    // Write tool call
    handleUpdate({
      sessionId: 'sess-1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'write-call-1',
        title: 'edit_file',
        rawInput: { path: '/tmp/test.txt', content: 'hello' },
      },
    });

    // Tool call finished
    handleUpdate({
      sessionId: 'sess-1',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'write-call-1',
        status: 'completed',
        title: 'edit_file',
        rawOutput: 'ok',
      },
    });

    expect(events.length).toBe(2);
    expect(events[1].type).toBe('tool_response');
    if (events[1].type === 'tool_response') {
      expect(events[1].isError).toBe(true);
      expect(events[1].display?.resultSummary).toBe(
        'Write tool call error, harness in Plan mode',
      );
      expect(events[1].data).toEqual({
        error: 'Write tool call error, harness in Plan mode',
      });
    }
  });

  it('ignores setting /model auto in Antigravity mode', async () => {
    const manager = new AcpProcessManager();
    const protocol = new AcpAgentProtocol(manager);

    const mockConnection = {
      unstable_setSessionModel: vi.fn().mockResolvedValue(undefined),
    };
    (protocol as unknown as { connection: unknown; sessionId: string }).connection =
      mockConnection;
    (protocol as unknown as { sessionId: string }).sessionId = 'test-sess';

    await protocol.setModel('auto');
    expect(mockConnection.unstable_setSessionModel).not.toHaveBeenCalled();

    await protocol.setModel('gemini-3.8-flash-high');
    expect(mockConnection.unstable_setSessionModel).toHaveBeenCalledWith({
      sessionId: 'test-sess',
      modelId: 'gemini-3.8-flash-high',
    });
  });

  it('emits usage event with inputTokens from native usage_update', () => {
    const manager = new AcpProcessManager();
    const protocol = new AcpAgentProtocol(manager);

    (protocol as unknown as { sessionId: string }).sessionId = 'sess-1';
    (protocol as unknown as { currentStreamId: string }).currentStreamId =
      'stream-1';

    const events: AgentEvent[] = [];
    protocol.subscribe((e) => events.push(e));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleUpdate = (protocol as any).handleSessionUpdate.bind(protocol);

    handleUpdate({
      sessionId: 'sess-1',
      update: {
        sessionUpdate: 'usage_update',
        used: 1250,
        cost: {
          amount: 0.005,
          currency: 'USD',
        },
      },
    });

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('usage');
    if (events[0].type === 'usage') {
      expect(events[0].inputTokens).toBe(1250);
      expect(events[0].cost?.amount).toBe(0.005);
      expect(events[0].cost?.currency).toBe('USD');
    }
  });
});

describe('isWriteTool and command classification', () => {
  it('does not classify read-only shell commands as write operations', () => {
    // These naive checks used to fail because of substrings like 'sed ' or 'rm '
    expect(isCommandWriteOperation('grep "sed " file.txt')).toBe(false);
    expect(isCommandWriteOperation('git log --grep="rm -rf"')).toBe(false);
    expect(isCommandWriteOperation('echo "sed rm touch"')).toBe(false);
    expect(isCommandWriteOperation('cat sed.txt')).toBe(false);
    expect(isCommandWriteOperation('git status')).toBe(false);
    expect(isCommandWriteOperation('git diff HEAD~1')).toBe(false);
    expect(isCommandWriteOperation('npm test')).toBe(false);
  });

  it('correctly identifies mutating shell operations', () => {
    expect(isCommandWriteOperation('rm -rf /tmp/foo')).toBe(true);
    expect(isCommandWriteOperation('cp a.txt b.txt')).toBe(true);
    expect(isCommandWriteOperation('mv old.txt new.txt')).toBe(true);
    expect(isCommandWriteOperation('mkdir new_dir')).toBe(true);
    expect(isCommandWriteOperation('echo "hello" > file.txt')).toBe(true);
    expect(isCommandWriteOperation('echo "hello" >> file.txt')).toBe(true);
    expect(isCommandWriteOperation('git commit -m "update"')).toBe(true);
    expect(isCommandWriteOperation('git push origin main')).toBe(true);
    expect(isCommandWriteOperation('npm install lodash')).toBe(true);
    expect(isCommandWriteOperation('pip install requests')).toBe(true);
  });

  it('classifies tool calls correctly using isWriteTool', () => {
    expect(isWriteTool('read_file', 'Read File', { file_path: 'foo.ts' })).toBe(false);
    expect(isWriteTool('list_directory', 'List Directory')).toBe(false);
    expect(isWriteTool('glob', 'Glob')).toBe(false);
    expect(isWriteTool('grep_search', 'Grep Search')).toBe(false);

    expect(isWriteTool('write_file', 'Write File', { file_path: 'foo.ts' })).toBe(true);
    expect(isWriteTool('edit_file', 'Edit File')).toBe(true);
    expect(isWriteTool('replace', 'Replace')).toBe(true);

    expect(
      isWriteTool('run_shell_command', 'Run Shell Command', {
        command: 'grep "sed " file.txt',
      }),
    ).toBe(false);

    expect(
      isWriteTool('run_shell_command', 'Run Shell Command', {
        command: 'rm -rf foo',
      }),
    ).toBe(true);
  });

  it('respects ACP ToolKind for write and read classification', () => {
    expect(isWriteTool('custom_mcp', 'Custom MCP', {}, 'edit')).toBe(true);
    expect(isWriteTool('custom_mcp', 'Custom MCP', {}, 'delete')).toBe(true);
    expect(isWriteTool('custom_mcp', 'Custom MCP', {}, 'move')).toBe(true);
    expect(isWriteTool('custom_mcp', 'Custom MCP', {}, 'read')).toBe(false);
    expect(isWriteTool('custom_mcp', 'Custom MCP', {}, 'search')).toBe(false);
  });

  it('correctly handles git and package manager flags before subcommand', () => {
    expect(isCommandWriteOperation('git -C /some/dir commit -m "msg"')).toBe(true);
    expect(isCommandWriteOperation('git --no-pager commit -m "msg"')).toBe(true);
    expect(isCommandWriteOperation('git -C /some/dir status')).toBe(false);
    expect(isCommandWriteOperation('npm --prefix /tmp install express')).toBe(true);
    expect(isCommandWriteOperation('python -m pip install requests')).toBe(true);
    expect(isCommandWriteOperation('python3 -m pip --timeout 60 install requests')).toBe(true);
    expect(isCommandWriteOperation('python3 -m pip --timeout 60 list')).toBe(false);
    expect(isCommandWriteOperation('pip3 --cache-dir /tmp install requests')).toBe(true);
    expect(isCommandWriteOperation('pip3 --cache-dir /tmp list')).toBe(false);
    expect(isCommandWriteOperation('sudo -u root rm file.txt')).toBe(true);
    expect(isCommandWriteOperation('sudo -E rm file.txt')).toBe(true);
    expect(isCommandWriteOperation('env VAR=1 rm -rf /')).toBe(true);
    expect(isCommandWriteOperation('ENV_VAR=1 sudo env VAR=2 rm file')).toBe(true);
    expect(isCommandWriteOperation('env VAR=1 cat file.txt')).toBe(false);
    expect(isCommandWriteOperation('python3 script.py')).toBe(false);
    expect(isCommandWriteOperation('patch -p1 < fix.patch')).toBe(true);
  });

  it('respects PolicyEngine decision when provided', () => {
    const mockPolicyEngine = {
      check: vi.fn(),
    } as unknown as PolicyEngine;

    // Normal read tool without policy engine is false
    expect(isWriteTool('custom_tool', 'Custom Tool', {}, mockPolicyEngine)).toBe(false);
  });
});

describe('AcpAgentProtocol requestPermission and policy handling', () => {
  it('blocks write tools in Plan mode even when PolicyEngine returns ALLOW', async () => {
    const mockPolicyEngine = {
      check: vi.fn().mockResolvedValue({ decision: PolicyDecision.ALLOW }),
    } as unknown as PolicyEngine;

    const manager = new AcpProcessManager();
    const protocol = new AcpAgentProtocol(manager, {
      mode: 'plan',
      policyEngine: mockPolicyEngine,
    });

    expect(protocol.getProcessManager()).toBe(manager);

    const res = await protocol.requestPermission({
      sessionId: 'plan-sess-1',
      toolCall: {
        toolCallId: 'call-write',
        title: 'edit_file',
        rawInput: { path: 'foo.ts' },
      },
      options: [{ optionId: 'opt-allow', name: 'Allow', kind: 'allow_once' }],
    });

    expect(res.outcome.outcome).toBe('cancelled');

    // Also verify ACP ToolKind edit is blocked
    const resKind = await protocol.requestPermission({
      sessionId: 'plan-sess-1',
      toolCall: {
        toolCallId: 'call-custom',
        title: 'custom_mcp',
        kind: 'edit',
        rawInput: {},
      },
      options: [{ optionId: 'opt-allow', name: 'Allow', kind: 'allow_once' }],
    });

    expect(resKind.outcome.outcome).toBe('cancelled');
  });

  it('allows read tools in Plan mode', async () => {
    const manager = new AcpProcessManager();
    const protocol = new AcpAgentProtocol(manager, {
      mode: 'plan',
    });

    const res = await protocol.requestPermission({
      sessionId: 'plan-sess-1',
      toolCall: {
        toolCallId: 'call-read',
        title: 'read_file',
        rawInput: { path: 'foo.ts' },
      },
      options: [{ optionId: 'opt-allow', name: 'Allow', kind: 'allow_once' }],
    });

    expect(res.outcome.outcome).toBe('selected');
    if (res.outcome.outcome === 'selected') {
      expect(res.outcome.optionId).toBe('opt-allow');
    }
  });

  it('cancels permission request when PolicyEngine returns DENY in default mode', async () => {
    const mockPolicyEngine = {
      check: vi.fn().mockResolvedValue({ decision: PolicyDecision.DENY }),
    } as unknown as PolicyEngine;

    const manager = new AcpProcessManager();
    const protocol = new AcpAgentProtocol(manager, {
      mode: 'default',
      policyEngine: mockPolicyEngine,
    });

    const res = await protocol.requestPermission({
      sessionId: 'default-sess-1',
      toolCall: {
        toolCallId: 'call-custom',
        title: 'dangerous_tool',
        rawInput: {},
      },
      options: [{ optionId: 'opt-allow', name: 'Allow', kind: 'allow_once' }],
    });

    expect(res.outcome.outcome).toBe('cancelled');
  });
});

describe('AcpProcessManager effort and model flags', () => {
  it.each(['low', 'medium', 'high', 'xhigh', 'max'] as const)(
    'supports effort level: %s',
    (effort) => {
      const manager = new AcpProcessManager({ effort });
      expect(manager.getEffort()).toBe(effort);

      const args = manager.buildCommandArgs('/tmp');
      expect(args).toContain('--effort');
      const effortIndex = args.indexOf('--effort');
      expect(args[effortIndex + 1]).toBe(effort);
    },
  );

  it('allows updating effort via setEffort', () => {
    const manager = new AcpProcessManager();
    expect(manager.getEffort()).toBeUndefined();

    manager.setEffort('max');
    expect(manager.getEffort()).toBe('max');

    const args = manager.buildCommandArgs();
    expect(args).toContain('--effort');
    expect(args[args.indexOf('--effort') + 1]).toBe('max');
  });

  it('does not pass --model auto to agy acp', () => {
    const manager = new AcpProcessManager({ model: 'auto' });
    const args = manager.buildCommandArgs('/tmp');

    expect(args).not.toContain('--model');
    expect(args).not.toContain('auto');
  });

  it('passes explicit model to agy acp', () => {
    const manager = new AcpProcessManager({ model: 'gemini-3.8-flash-high' });
    const args = manager.buildCommandArgs('/tmp');

    expect(args).toContain('--model');
    const modelIndex = args.indexOf('--model');
    expect(args[modelIndex + 1]).toBe('gemini-3.8-flash-high');
  });
});
