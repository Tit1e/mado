/**
 * [INPUT]: 依赖 Pi RPC 的生命周期与工具事件
 * [OUTPUT]: 对外提供 createDiscordProgress，聚合关键阶段、工具计数并按节流间隔输出纯文字进度
 * [POS]: electron 的 Discord 进度领域服务，不转发思考、工具参数或原始输出
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';
const TOOL_LABELS = Object.freeze({
  read: '读取文件', grep: '搜索代码', find: '查找文件', ls: '查看目录',
  edit: '修改代码', write: '写入文件', bash: '运行项目命令', powershell: '运行项目命令',
});
function createDiscordProgress({ onUpdate, intervalMs = 1800, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const counts = { read: 0, search: 0, edit: 0, command: 0, other: 0 };
  let stage = '准备开始';
  let assistantText = '';
  let pendingTimer = null;
  let stopped = false;
  function category(tool) {
    if (['read', 'ls'].includes(tool)) return 'read';
    if (['grep', 'find'].includes(tool)) return 'search';
    if (['edit', 'write'].includes(tool)) return 'edit';
    if (['bash', 'powershell'].includes(tool)) return 'command';
    return 'other';
  }
  function text() {
    const header = `Pi 正在处理任务\n\n当前阶段：${stage}\n读取：${counts.read} 次\n搜索：${counts.search} 次\n修改：${counts.edit} 次\n命令：${counts.command} 次`;
    const body = assistantText.trim();
    return body ? `${header}\n\n当前正文：\n${body}` : header;
  }
  function flush() {
    pendingTimer = null;
    if (!stopped) void onUpdate(text());
  }
  function schedule() {
    if (stopped || pendingTimer) return;
    pendingTimer = setTimer(flush, intervalMs);
  }
  function event(event) {
    if (stopped || !event) return;
    if (event.type === 'agent_start') { stage = '分析项目'; schedule(); return; }
    if (event.type === 'compaction_start') { stage = '整理上下文'; schedule(); return; }
    if (event.type === 'auto_retry_start') { stage = '重试请求'; schedule(); return; }
    if (event.kind === 'assistant_delta') { assistantText = (assistantText + String(event.text || '')).slice(-12000); schedule(); return; }
    if (event.kind === 'tool_start') {
      const tool = String(event.toolName || '').toLowerCase();
      const key = category(tool); counts[key] += 1; stage = TOOL_LABELS[tool] || '执行 Agent 工具'; schedule(); return;
    }
    if (event.kind === 'retry') { stage = '重试请求'; schedule(); return; }
    if (event.type === 'tool_execution_start') {
      const tool = String(event.toolName || '').toLowerCase();
      const key = category(tool);
      counts[key] += 1;
      stage = TOOL_LABELS[tool] || '执行 Agent 工具';
      schedule();
    }
  }
  function stop() { stopped = true; if (pendingTimer) clearTimer(pendingTimer); pendingTimer = null; }
  return { event, flush: () => { if (!stopped) flush(); }, stop, snapshot: () => ({ stage, ...counts }) };
}
module.exports = { TOOL_LABELS, createDiscordProgress };
