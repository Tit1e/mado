/**
 * [INPUT]: 依赖 Electron 的 contextBridge、ipcRenderer 和 webUtils 受控系统能力
 * [OUTPUT]: 对外提供 PTY、终端恢复、Codex 启动与命令重启快捷键、文件、剪贴板、更新、窗口、菜单语言与环境受控桥接
 * [POS]: electron 模块的安全桥接层，在 contextIsolation 下连接渲染进程与主进程 IPC
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('madoPty', {
  spawn: (opts) => ipcRenderer.invoke('pty:spawn', opts),
  input: (id, data) => ipcRenderer.send('pty:input', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  kill: (id) => ipcRenderer.send('pty:kill', { id }),
  cwd: (id) => ipcRenderer.invoke('pty:cwd', { id }),
  hasForegroundProcess: (id) => ipcRenderer.invoke('pty:has-foreground-process', { id }),
  restartCommand: (id) => ipcRenderer.invoke('pty:restart-command', { id }),
  onData: (cb) => { const h = (e, m) => cb(m); ipcRenderer.on('pty:data', h); return () => ipcRenderer.removeListener('pty:data', h); },
  onExit: (cb) => { const h = (e, m) => cb(m); ipcRenderer.on('pty:exit', h); return () => ipcRenderer.removeListener('pty:exit', h); },
});

contextBridge.exposeInMainWorld('madoRecovery', {
  list: () => ipcRenderer.invoke('terminal-recovery:list'),
  take: (ids) => ipcRenderer.invoke('terminal-recovery:take', { ids }),
  clear: () => ipcRenderer.invoke('terminal-recovery:clear'),
});

contextBridge.exposeInMainWorld('madoFs', {
  watch: (dir) => ipcRenderer.invoke('fs:watch', { dir }),
  watchSet: (dirs) => ipcRenderer.invoke('fs:watch-set', { dirs }),
  onChanged: (cb) => { const h = (e, m) => cb(m); ipcRenderer.on('fs:changed', h); return () => ipcRenderer.removeListener('fs:changed', h); },
});

contextBridge.exposeInMainWorld('madoClipboard', {
  copyImage: (path) => ipcRenderer.invoke('clip:image', { path }),
  copyFile: (path) => ipcRenderer.invoke('clip:file', { path }),
});

contextBridge.exposeInMainWorld('madoDrop', {
  // 系统拖入的 File → 真实路径（Electron 32+ 移除了 File.path，须走 webUtils）
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  // file-promise 类拖拽（如 macOS 截图浮窗缩略图）没有现成路径：把内容落盘到临时目录换一个路径
  saveTemp: (name, buf) => ipcRenderer.invoke('drop:save', { name, buf }),
  // 拖进文件区：没路径的拖入内容（截图浮窗等）直接存进目标目录
  saveInto: (dir, name, buf) => ipcRenderer.invoke('drop:save-into', { dir, name, buf }),
  // 拖进文件区：已有路径的文件（Finder 文件）复制进目标目录
  copyInto: (srcPath, dir) => ipcRenderer.invoke('drop:copy-into', { srcPath, dir }),
});

contextBridge.exposeInMainWorld('madoShot', {
  // 系统截屏落盘事件（截图直通车）
  onNew: (cb) => { const h = (e, m) => cb(m); ipcRenderer.on('shot:new', h); return () => ipcRenderer.removeListener('shot:new', h); },
});

contextBridge.exposeInMainWorld('madoUpdate', {
  onAvailable: (cb) => { const h = (e, m) => cb(m); ipcRenderer.on('update:available', h); return () => ipcRenderer.removeListener('update:available', h); },
  get: () => ipcRenderer.invoke('update:get'), // 拉一把启动早期可能错过的推送
  open: (url) => ipcRenderer.invoke('update:open', { url }),
  download: (version) => ipcRenderer.invoke('update:download', { version }), // #26 应用内下载对应架构 dmg
  onProgress: (cb) => { const h = (e, m) => cb(m); ipcRenderer.on('update:progress', h); return () => ipcRenderer.removeListener('update:progress', h); },
});

contextBridge.exposeInMainWorld('madoWin', {
  focus: () => ipcRenderer.invoke('win:focus'), // 点通知拉回前台
  trafficLights: (show) => ipcRenderer.invoke('win:traffic', { show }), // 全屏预览时藏/显左上角系统按钮
  onNewTerminal: (cb) => { const h = () => cb(); ipcRenderer.on('terminal:new', h); return () => ipcRenderer.removeListener('terminal:new', h); },
  onLaunchCodex: (cb) => { const h = () => cb(); ipcRenderer.on('terminal:launch-codex', h); return () => ipcRenderer.removeListener('terminal:launch-codex', h); },
  onLaunchNewCodex: (cb) => { const h = () => cb(); ipcRenderer.on('terminal:launch-codex-new', h); return () => ipcRenderer.removeListener('terminal:launch-codex-new', h); },
  onRestartActiveCommand: (cb) => { const h = () => cb(); ipcRenderer.on('terminal:restart-active', h); return () => ipcRenderer.removeListener('terminal:restart-active', h); },
  onCloseActiveTerminal: (cb) => { const h = () => cb(); ipcRenderer.on('terminal:close-active', h); return () => ipcRenderer.removeListener('terminal:close-active', h); },
});

contextBridge.exposeInMainWorld('madoLocale', {
  refreshMenu: () => ipcRenderer.invoke('locale:refresh-menu'),
});

contextBridge.exposeInMainWorld('madoEnv', {
  isDesktopApp: true,
  platform: process.platform,
});
