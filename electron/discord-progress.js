/**
 * [INPUT]: 依赖 Pi RPC 返回的 assistant 与工具事件
 * [OUTPUT]: 对外提供 createDiscordProgress，仅输出 Pi 正文或结构化工具节点的最小翻译
 * [POS]: electron 的 Discord Pi 过程转发器，不创建生命周期文案、不输出统计和思考内容
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';
const path = require('path');
const TOOL_LABELS = Object.freeze({ read: '正在读取', write: '正在写入', edit: '正在修改', grep: '正在搜索代码', find: '正在查找文件', ls: '正在查看目录', bash: '正在运行项目命令', powershell: '正在运行项目命令' });
function createDiscordProgress({ onUpdate, intervalMs = 1800, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let text = '';
  let pendingTimer = null;
  let stopped = false;
  function schedule() { if (!stopped && !pendingTimer) pendingTimer = setTimer(() => { pendingTimer = null; void onUpdate(text); }, intervalMs); }
  function target(args) {
    const value = args?.path || args?.filePath || args?.file || args?.query;
    if (!value || typeof value !== 'string') return '';
    return path.basename(value).slice(0, 120);
  }
  function event(event) {
    if (stopped || !event) return;
    if (event.kind === 'assistant_delta') { text = `${text}${String(event.text || '')}`.slice(-1800); schedule(); return; }
    if (event.kind === 'tool_start') {
      const tool = String(event.toolName || '').toLowerCase();
      text = `${TOOL_LABELS[tool] || '正在执行工具'}${target(event.args) ? ` ${target(event.args)}` : ''}`;
      schedule(); return;
    }
    if (event.kind === 'retry') { text = '正在自动重试'; schedule(); return; }
    if (event.kind === 'compaction') { text = '正在整理上下文'; schedule(); }
  }
  function stop() { stopped = true; if (pendingTimer) clearTimer(pendingTimer); pendingTimer = null; }
  return { event, flush: () => { if (!stopped) { if (pendingTimer) clearTimer(pendingTimer); pendingTimer = null; void onUpdate(text); } }, stop };
}
module.exports = { TOOL_LABELS, createDiscordProgress };
