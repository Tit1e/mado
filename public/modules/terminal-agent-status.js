/**
 * [INPUT]: 依赖终端控制器会话、DOM 查询、提示音与文件区反馈回调
 * [OUTPUT]: 对外提供 createTerminalAgentStatus，管理 Agent 忙闲判断、提醒、通知和回复摘要
 * [POS]: public/modules 的终端 Agent 状态子控制器，从 terminal.js 分离高频输出与通知职责
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
const AGENT_ASK_RE = /(Do you want to (proceed|continue|make this edit|allow|use this)|Would you like to proceed|Ready to code\?|created or one you trust\?|tell Codex what to do differently|Yes, and don't ask again|Allow Codex to (run|apply|create)|Codex wants to|[❯›][ \t]*1\.[ \t]*Yes)/;

export function createTerminalAgentStatus({ $, term, playChime, rippleFileArea }) {
  let statusTimer = null;
  let awaitingTimer = null;

  function tailText(session, lineCount = 25) {
    try {
      const buffer = session.xterm.buffer.active;
      let text = '';
      for (let i = Math.max(0, buffer.length - lineCount); i < buffer.length; i++) {
        const line = buffer.getLine(i);
        if (line) text += line.translateToString(true) + '\n';
      }
      return text;
    } catch { return ''; }
  }

  function lastReplyExcerpt(session, maxLength = 160) {
    const junk = /esc to interrupt|\? for shortcuts|for commands|bypass|auto-accept|accept edits|plan mode|shift\+tab|context left|tokens used|still running|·\s*\d+\s+(shells?|monitors?|tasks?|agents?)\b/i;
    const lines = [];
    for (const raw of tailText(session, 40).split('\n')) {
      const text = raw.replace(/^[\s│┃]+|[\s│┃]+$/g, '').replace(/^[⏺●◉>]\s+/, '').trim();
      if (!text || /^[╭╰╮╯├┤─━┄┆┈·•．.…*=_-]+$/.test(text) || junk.test(text)) continue;
      lines.push(text);
    }
    const text = lines.slice(-3).join(' ').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
  }

  function notify(session, title, body) {
    try {
      if (typeof Notification === 'undefined') return;
      const fire = () => {
        const notification = new Notification(title, { body });
        notification.onclick = () => {
          try { if (window.madoWin) window.madoWin.focus(); else window.focus(); } catch { /* 窗口不可用时只关闭通知 */ }
          if (session && term.sessions.includes(session)) { term.open(); term.activate(session.id); }
          try { notification.close(); } catch { /* 通知可能已被系统关闭 */ }
        };
      };
      if (Notification.permission === 'granted') fire();
      else if (Notification.permission !== 'denied') Notification.requestPermission().then((permission) => { if (permission === 'granted') fire(); });
    } catch { /* 通知不可用不影响终端 */ }
  }

  function awaitGlow() {
    const panel = $('#terminal-panel');
    if (!panel || panel.classList.contains('hidden')) return;
    panel.classList.add('term-awaiting');
    clearTimeout(awaitingTimer);
    awaitingTimer = setTimeout(() => panel.classList.remove('term-awaiting'), 6500);
  }

  function ensureStatusTick() {
    if (statusTimer) return;
    statusTimer = setInterval(() => {
      const now = Date.now();
      let anyBusy = false;
      term.sessions.forEach((session) => {
        if (session.status !== 'busy') return;
        term.atlasCare(now);
        const quiet = now - (session.lastData || 0);
        if (quiet <= 2500) { anyBusy = true; return; }
        const tail = tailText(session);
        if (quiet < 30000 && /esc to interrupt/i.test(tail)) { anyBusy = true; return; }
        const duration = (session.lastReal || 0) - (session.busyStart || 0);
        session.status = 'idle';
        term.atlasCare(now, true);
        term.renderTabs();
        term.refreshCwd(session);
        const footer = tailText(session, 8);
        if (/\bstill running\b/i.test(footer) || /·\s*\d+\s+(shells?|monitors?|tasks?|agents?)\b/i.test(footer)) return;
        const asksUser = duration > 600 && AGENT_ASK_RE.test(tail);
        if (asksUser || duration > 1500) awaitGlow();
        if (asksUser) {
          playChime('ask');
          if (!document.hasFocus() || session.id !== term.active) notify(session, '等待你确认 · ' + (session.title || 'shell'), lastReplyExcerpt(session) || (session.title || 'shell') + ' 在等你拍板');
        } else if (duration > 4000) {
          rippleFileArea();
          playChime('done');
          if (!document.hasFocus() || session.id !== term.active) notify(session, 'Agent 任务完成 · ' + (session.title || 'shell'), lastReplyExcerpt(session) || (session.title || 'shell') + ' 已空闲');
        }
      });
      if (!anyBusy) { clearInterval(statusTimer); statusTimer = null; }
    }, 600);
  }

  function markBusy(session) {
    const now = Date.now();
    $('#terminal-panel').classList.remove('term-awaiting');
    if (session.kind === 'service') {
      session.lastData = now;
      if (session.id !== term.active && session.revealed && !session.unread) { session.unread = true; term.renderTabs(); }
      return;
    }
    if (now - (session.lastInput || 0) < 400) { if (session.status === 'busy') session.lastData = now; return; }
    session.lastData = now;
    session.lastReal = now;
    if (session.status !== 'busy') { session.status = 'busy'; session.busyStart = now; term.renderTabs(); }
    if (session.id !== term.active && !session.unread) { session.unread = true; term.renderTabs(); }
    ensureStatusTick();
  }

  return { markBusy, tailText, lastReplyExcerpt, notify };
}
