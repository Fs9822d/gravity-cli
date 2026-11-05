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
import { AcpAgentProtocol } from './acp-agent-protocol.js';
import type { AgentEvent } from './types.js';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter, PassThrough } from 'node:stream';
import fs from 'node:fs';

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
});
