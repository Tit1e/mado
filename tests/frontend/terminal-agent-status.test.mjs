/**
 * [INPUT]: 依赖 happy-dom 与 public/modules/terminal-agent-status.js
 * [OUTPUT]: 验证终端输出摘要过滤和隐藏服务未读状态，不引入 Codex 专属完成文案
 * [POS]: tests/frontend 的 Agent 状态子控制器回归测试，保护从 terminal.js 提取后的核心行为
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installDom, loadRendererModule } from './dom-environment.mjs';

const { createTerminalAgentStatus } = await loadRendererModule('terminal-agent-status');

function outputSession(lines, overrides = {}) {
  return {
    id: 't1', kind: 'terminal', status: 'idle',
    xterm: { buffer: { active: { length: lines.length, getLine: (index) => ({ translateToString: () => lines[index] }) } } },
    ...overrides,
  };
}

test('回复摘要过滤 TUI 页脚并保留最后正文', () => {
  const dom = installDom('<section id="terminal-panel"></section>');
  try {
    const term = { sessions: [], renderTabs() {}, atlasCare() {}, refreshCwd() {} };
    const status = createTerminalAgentStatus({ $: (selector) => document.querySelector(selector), term, playChime() {}, rippleFileArea() {} });
    const session = outputSession(['│ 完成项目配置 │', '? for shortcuts', 'esc to interrupt']);
    assert.equal(status.tailText(session, 2), '? for shortcuts\nesc to interrupt\n');
    assert.equal(status.lastReplyExcerpt(session), '完成项目配置');
  } finally { dom.cleanup(); }
});

test('隐藏服务输出只更新未读状态，不进入 Agent 完成通知', () => {
  const dom = installDom('<section id="terminal-panel"></section>');
  try {
    let renders = 0;
    const session = outputSession([], { kind: 'service', revealed: true });
    const term = { sessions: [session], active: 'other', renderTabs() { renders++; }, atlasCare() {}, refreshCwd() {} };
    const status = createTerminalAgentStatus({ $: (selector) => document.querySelector(selector), term, playChime() {}, rippleFileArea() {} });
    status.markBusy(session);
    assert.equal(session.unread, true);
    assert.equal(renders, 1);
    assert.equal(session.status, 'idle');
  } finally { dom.cleanup(); }
});
