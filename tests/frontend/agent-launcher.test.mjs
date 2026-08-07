/**
 * [INPUT]: 依赖 public/modules/agent-launcher.js 固定命令映射
 * [OUTPUT]: 验证 Codex/Pi 继续与新建命令，并拒绝未知 Agent、动作和 Pi 历史选择入口
 * [POS]: tests/frontend 的第一方 Agent 启动安全契约测试，防止任意命令进入终端启动链
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRendererModule } from './dom-environment.mjs';

const { resolveAgentLaunch } = await loadRendererModule('agent-launcher');

test('Codex 与 Pi 只暴露继续和新建命令', () => {
  assert.equal(resolveAgentLaunch('codex', 'continue').command, 'codex resume --last');
  assert.equal(resolveAgentLaunch('codex', 'new').command, 'codex');
  assert.equal(resolveAgentLaunch('pi', 'continue').command, 'pi -c');
  assert.equal(resolveAgentLaunch('pi', 'new').command, 'pi');
});

test('未知 Agent、动作和 Pi 历史选择不会生成命令', () => {
  assert.equal(resolveAgentLaunch('claude', 'continue'), null);
  assert.equal(resolveAgentLaunch('pi', 'resume'), null);
  assert.equal(resolveAgentLaunch('pi', 'r'), null);
  assert.equal(resolveAgentLaunch('codex', 'constructor'), null);
  assert.equal(resolveAgentLaunch('toString', 'apply'), null);
  assert.equal(resolveAgentLaunch('__proto__', 'new'), null);
  assert.equal(resolveAgentLaunch('', 'new'), null);
});
