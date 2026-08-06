/**
 * [INPUT]: 依赖 Electron app/dialog、PTY 服务、窗口获取函数和开发模式控制消息
 * [OUTPUT]: 对外提供 createDevReloadService 与开发重启退出码，安全执行渲染刷新或应用重启
 * [POS]: electron 模块的开发期刷新守卫，防止热更新静默终止内嵌终端
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const DEV_RESTART_EXIT_CODE = 85;

function createDevReloadService({ app, dialog, ptyService, getWindow = () => null, translate = (zh) => zh }) {
  let checking = false;

  async function confirm(action) {
    if (ptyService.count() === 0) return true;
    const win = getWindow();
    const verb = action === 'restart' ? translate('重启', 'restart') : translate('刷新', 'reload');
    const { response } = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
      type: 'warning',
      buttons: [translate('稍后', 'Later'), action === 'restart' ? translate('重启', 'Restart') : translate('刷新', 'Reload')],
      defaultId: 0,
      cancelId: 0,
      message: translate('Mado 源码已经更新', 'Mado source has changed'),
      detail: translate(`当前还有 ${ptyService.count()} 个终端。${verb}会关闭这些终端，是否继续？`, `${ptyService.count()} terminal(s) are still open. Continuing will close them.`),
    });
    return response === 1;
  }

  async function request(action) {
    if (checking || (action !== 'reload' && action !== 'restart')) return false;
    checking = true;
    try {
      if (!await confirm(action)) return false;
      ptyService.killAll();
      if (action === 'restart') app.exit(DEV_RESTART_EXIT_CODE);
      else {
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.reloadIgnoringCache();
      }
      return true;
    } catch {
      return false;
    } finally {
      checking = false;
    }
  }

  return { request, isChecking: () => checking };
}

module.exports = { DEV_RESTART_EXIT_CODE, createDevReloadService };
