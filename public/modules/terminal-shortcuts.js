/**
 * [INPUT]: 依赖终端控制器、Electron PTY/窗口桥接、确认弹窗与轻提示
 * [OUTPUT]: 对外提供 createTerminalShortcutActions，统一处理当前终端关闭、命令重启和 Codex/Pi 桌面启动事件绑定
 * [POS]: public/modules 的终端快捷动作边界，被 terminal.js 装配并复用其标签生命周期能力
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
export function createTerminalShortcutActions({ term, pty, win, confirmDialog, toast }) {
  let closePrompting = false;
  const restarting = new Set();
  const removers = {};

  async function closeActive() {
    const session = term.sessions.find((item) => item.id === term.active);
    if (!session) return false;
    const foreground = await pty.hasForegroundProcess(session.id).catch(() => ({ ok: false, running: false }));
    if (foreground.ok && foreground.running) {
      if (closePrompting) return false;
      closePrompting = true;
      try {
        const confirmed = await confirmDialog('当前终端仍在运行任务，关闭会立即终止任务。确定关闭？');
        if (!confirmed) return false;
      } finally { closePrompting = false; }
    }
    term.closeTab(session.id);
    return true;
  }

  async function restartActive() {
    const session = term.sessions.find((item) => item.id === term.active);
    if (!session || session.dead) { toast('当前没有可重新运行的终端', true); return false; }
    if (restarting.has(session.id)) { toast('当前命令正在重新运行'); return false; }
    if (!pty || typeof pty.restartCommand !== 'function') { toast('当前环境不支持重新运行命令', true); return false; }
    restarting.add(session.id);
    try {
      const result = await pty.restartCommand(session.id).catch(() => ({ ok: false, error: '重新运行命令失败' }));
      toast(result && result.ok ? '已重新运行当前命令' : (result?.error || '重新运行命令失败'), !(result && result.ok));
      return !!(result && result.ok);
    } finally { restarting.delete(session.id); }
  }

  function bindDesktopEvents() {
    if (win?.onNewTerminal && !removers.newTerminal) removers.newTerminal = win.onNewTerminal(() => term.newTerminal());
    if (win?.onLaunchAgent && !removers.launchAgent) removers.launchAgent = win.onLaunchAgent(({ agent, action } = {}) => {
      term.launchAgent(agent, action === 'preferred' ? undefined : { action });
    });
    if (win?.onRestartActiveCommand && !removers.restartActive) removers.restartActive = win.onRestartActiveCommand(() => term.restartActive());
    if (win?.onCloseActiveTerminal && !removers.closeActive) removers.closeActive = win.onCloseActiveTerminal(() => term.closeActive());
  }

  return { closeActive, restartActive, bindDesktopEvents };
}
