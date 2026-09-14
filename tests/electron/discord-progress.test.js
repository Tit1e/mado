/**
 * [INPUT]: 依赖 Node 内置测试与 Discord 进度聚合器
 * [OUTPUT]: 对外提供关键阶段、计数、节流和无 Emoji 输出的回归验证
 * [POS]: tests/electron 的 Discord 远程进度测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordProgress } = require('../../electron/discord-progress');

test('进度只输出关键阶段和工具计数，不包含 Emoji 或原始参数', () => {
  const output = [];
  const progress = createDiscordProgress({ onUpdate: (value) => output.push(value) });
  progress.event({ type: 'agent_start' });
  progress.event({ type: 'progress', kind: 'assistant_delta', text: '正在检查项目结构。' });
  progress.event({ type: 'tool_execution_start', toolName: 'read', args: { path: '/private/file' } });
  progress.event({ type: 'tool_execution_start', toolName: 'edit', args: { content: 'secret' } });
  progress.flush();
  assert.equal(output.length, 1);
  assert.equal(output[0], '正在检查项目结构。');
  assert.doesNotMatch(output[0], /private|secret|[\u{1F300}-\u{1FAFF}]/u);
});

test('连续事件只安排一次节流刷新', () => {
  const timers = [];
  let updates = 0;
  const progress = createDiscordProgress({ onUpdate: () => { updates += 1; }, setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  progress.event({ type: 'progress', kind: 'tool_start', toolName: 'bash', args: {} });
  progress.event({ type: 'progress', kind: 'tool_start', toolName: 'bash', args: {} });
  assert.equal(timers.length, 1);
  timers[0]();
  assert.equal(updates, 1);
});
