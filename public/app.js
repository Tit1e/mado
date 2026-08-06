/**
 * [INPUT]: 依赖 index.html DOM、generated/ui.mjs Svelte 界面岛、HTTP/Git API、xterm/Monaco/Milkdown 和 Electron PTY/恢复桥与快捷动作
 * [OUTPUT]: 对外提供文件管理、Git 查看、预览编辑、内嵌终端及选择性命令恢复、Codex 会话、命令重启和全局交互
 * [POS]: public 模块的渲染层主入口，集中编排页面状态、视图和桌面能力
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

import { createIcons } from './modules/icons.js';
import { createEditors } from './modules/editors.js';
import { createSidebarController } from './modules/sidebar.js';
import { createCommandPalette } from './modules/command-palette.js';
import { createTerminalController } from './modules/terminal.js';
import { createTerminalShortcutActions } from './modules/terminal-shortcuts.js';
import { createFileFollowController } from './modules/file-follow.js';
import { createImageEditor } from './modules/image-editor.js';
import { createProjectRunController } from './modules/project-run.js';
import { createFileBrowserController } from './modules/file-browser.js';
import { createPreviewController } from './modules/preview.js';
import { createFileActionsController } from './modules/file-actions.js';
import { createUiController } from './modules/ui-controller.js';
import { startApplication } from './modules/lifecycle.js';
import { createEffects } from './modules/effects.js';
import { guardEditExit } from './modules/edit-session.js';
import { createCodexProjectsService, createContextMenuService, createDialogService, createDiskPanelService, createFavoritesService, createFileListService, createGitPanel, createRootsService, createSegmentedControlService } from './generated/ui.mjs';

const $ = (s) => document.querySelector(s);
const api = (p) => fetch(p).then((r) => r.json());
const apiPost = (p, body) => fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());


const state = {
  cwd: null, home: null, platform: 'darwin', sep: '/',
  theme: localStorage.getItem('codexbox_theme') || 'warm',
  entries: [], project: null, history: [],
  sort: localStorage.getItem('codexbox_sort') || 'name',
  showHidden: localStorage.getItem('codexbox_hidden') === '1',
  filter: '', selected: null, cursor: -1, visible: [],
  favorites: [], recentOpened: [],
  previewW: Number(localStorage.getItem('codexbox_preview_w')) || 0, // 0 = 用户还没拖过，走 1:2 比例默认
  previewH: Number(localStorage.getItem('codexbox_preview_h')) || 0,
  sidebarCollapsed: localStorage.getItem('codexbox_sidebar_collapsed') === '1',
  sidebarW: Math.min(420, Math.max(190, Number(localStorage.getItem('codexbox_sidebar_w')) || 248)),
  muted: localStorage.getItem('codexbox_muted') === '1', // WOW4 提示音静音开关
};
const follow = {
  on: false,
  sid: null,         // 开启时绑定的终端会话 id——只跟这个 agent 项目目录里的写入
  label: '',         // 绑定终端的项目名，给 UI 显示「在跟哪个 agent」
  path: null,        // 正在跟随的文件（绝对路径）
  lastContent: null, // 上次渲染的文本内容，用于定位本次改动行
  pendingPath: null, // 节流窗口内最新的待切换目标
  navving: false,    // 跟随自己发起的 navigate，不触发「手动接管即停」
  swapping: false,   // html 双缓冲换页进行中
  swapDirty: false,  // 换页期间又来了新写入，换完补刷一次
  recentChanges: [], // 最近 5 分钟的轻量路径缓存，只用于开启跟随后立即追上目标
  timers: {},
};
const runtime = {
  get imgEditState() { return imgEditState; },
  set imgEditState(value) { imgEditState = value; },
  get currentEditor() { return currentEditor; },
  set currentEditor(value) { currentEditor = value; },
  get dirtyCheck() { return dirtyCheck; },
  set dirtyCheck(value) { dirtyCheck = value; },
  get autosaveFlush() { return autosaveFlush; },
  set autosaveFlush(value) { autosaveFlush = value; },
  get edStatusTimer() { return edStatusTimer; },
  set edStatusTimer(value) { edStatusTimer = value; },
};
const { SVG, svgWrap, ic, iconSvg, richIcon, TERM_LINK_RE_BARE } = createIcons(state);
const { mona, crepe } = createEditors(state);

// ---------- 工具 ----------
function fmtSize(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}
function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const diff = Date.now() - ms;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// 跨平台路径处理：用服务端返回的分隔符
function dirOf(p) { const i = p.lastIndexOf(state.sep); return i > 0 ? p.slice(0, i) : p; }
function baseOf(p) { const parts = p.split(state.sep).filter(Boolean); return parts[parts.length - 1] || p; }
function tilde(p) { return state.home && p.startsWith(state.home) ? '~' + p.slice(state.home.length) : p; }
function isFav(path) { return state.favorites.some((f) => f.path === path); }
function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- 未保存守卫 ----------
// 文本/图片编辑期间，离开当前编辑器（点别的文件、跳目录、关预览）都要先确认，
// 否则会静默丢掉改动。dirtyCheck 在进入编辑器时挂上，保存/确认离开后清空。
let dirtyCheck = null; // () => boolean，true=有未保存改动；null=当前没有编辑器
let autosaveFlush = null; // 自动保存编辑器挂上：离开前把未落盘的改动写掉，不弹「放弃？」
let edStatusTimer = null; // 代码编辑器「xx 之前已保存」每秒刷新的定时器；编辑器关掉时自清
// 当前打开的 md 编辑器，供「外部文件变更」时重载用。{ path, isDirty(), reload() }；离开时清空。
let currentEditor = null;
let imgEditState = null;
let enterImageEdit;
async function guardDirty() {
  return guardEditExit(runtime, (...args) => confirmDialog(...args));
}
const isMdName = (n) => /\.(md|markdown)$/i.test(String(n || ''));
const isHtmlName = (n) => /\.(html?|xhtml)$/i.test(String(n || ''));

let navigate, updateWatches, shQuote, goBack, goUp, render, renderBreadcrumb, visibleEntries;
let renderStatusbar, renderFiles, makeDraggablePath, applySelection, moveCursor, cursorEnter;
let dropFilesInto, dropUrlInto;

let openPreview, showDiff, renderTextPreview, fsUrl, renderPreviewActions, renderPreviewFoot, closePreview;
let applyLayout, bindSelectionToTerminal, enableTooltips, bindSidebarResizer, applyPreviewSize;
let animateLayout, restoreFileAreaIfHidden, showPreviewPanel, setPreviewMax, isPreviewMax, toggleSidebar, lightbox;

let selfOpened, openWith, copyPath, recordRecent, toggleFav, refresh, enterEditMode, mdEditor;
let doRename, doTrash, doCreate, inputDialog, confirmDialog, diskPanel;
let showContextMenu, popupMenu, shotTray;
let loadRoots, renderRootsActive, loadFavorites, renderFavs, loadCodexProjects, showCodexProjectMenu, openFavoriteFile;
let cmdk;
let term;
let gitPanel;
let projectRun;

let maybeShowGuide, bindResizer, bindTerminalResizer, codexResumeLast, bindCodexControls, bindEvents, applyTheme;
let undoImage;


let setFileFollow, rememberFollowChange, followChange;
const { isNoisyChange, kindFromName, rippleFileArea, playChime } = createEffects(state, $);
const dialogService = createDialogService();
const { recoveryDialog } = dialogService;
const contextMenuService = createContextMenuService();
const segmentedControlService = createSegmentedControlService();
const diskPanelService = createDiskPanelService({ api, formatSize: fmtSize, parentOf: dirOf, separatorOf: () => state.sep, homeOf: () => state.home });
const codexProjectsService = createCodexProjectsService({
  target: $('#codex-projects-list'), api,
  navigate: (...args) => navigate(...args),
  makeDraggable: (...args) => makeDraggablePath(...args),
  openMenu: (...args) => showCodexProjectMenu(...args),
  folderIcon: svgWrap(SVG.folder, 'currentColor', 16, true),
});
const favoritesService = createFavoritesService({
  target: $('#favs-list'), api,
  navigate: (...args) => navigate(...args),
  openFile: (...args) => openFavoriteFile(...args),
  remove: (...args) => toggleFav(...args),
  makeDraggable: (...args) => makeDraggablePath(...args),
  folderIcon: svgWrap(SVG.folder, 'currentColor', 16, true),
  fileIcon: svgWrap(SVG.file, 'currentColor', 16),
});
const rootsService = createRootsService({
  target: $('#roots-list'), api,
  navigate: (...args) => navigate(...args),
  makeDraggable: (...args) => makeDraggablePath(...args),
  folderIcon: svgWrap(SVG.folder, 'currentColor', 16, true),
});
const fileListService = createFileListService({
  target: $('#file-area'), iconSvg,
  formatSize: fmtSize, formatTime: fmtTime,
  favoriteIcon: (on) => svgWrap(SVG.star, 'currentColor', 15, on),
  emptyIcon: ic('inbox', 'currentColor', 48),
});
let themeControl;

function setupSegmentedControls() {
  segmentedControlService.mount({
    target: $('#sort-seg'), value: state.sort, variant: 'compact-text', ariaLabel: '排序方式',
    items: [{ value: 'name', label: '名称' }, { value: 'mtime', label: '时间' }, { value: 'size', label: '大小' }],
    onChange: (value) => { state.sort = value; localStorage.setItem('codexbox_sort', value); renderFiles(); },
  });
  themeControl = segmentedControlService.mount({
    target: $('#theme-seg'), value: state.theme, variant: 'regular', ariaLabel: '皮肤',
    items: [
      { value: 'warm', label: '档案', title: '暖色纸感档案馆' },
      { value: 'terminal', label: '终端', title: '终端核 Volt' },
      { value: 'editorial', label: '索引', title: '编辑式 · 索引日报' },
    ],
    onChange: (value) => applyTheme(value),
  });
}


function setupControllers() {
  const termProxy = new Proxy({}, {
    get(_target, key) {
      const value = term && term[key];
      return typeof value === 'function' ? value.bind(term) : value;
    },
    set(_target, key, value) { term[key] = value; return true; },
  });
  ({
    selfOpened, openWith, copyPath, recordRecent, toggleFav, refresh, enterEditMode, mdEditor,
    doRename, doTrash, doCreate, inputDialog, confirmDialog,
    diskPanel, showContextMenu, popupMenu, shotTray,
  } = createFileActionsController({
    $, state, api, apiPost, toast,
    inputDialog: dialogService.inputDialog,
    confirmDialog: dialogService.confirmDialog,
    popupMenu: contextMenuService.popupMenu,
    closeContextMenu: contextMenuService.closeContextMenu,
    diskPanel: diskPanelService.diskPanel,
    loadFavorites: (...args) => loadFavorites(...args),
    renderFavs: (...args) => renderFavs(...args),
    renderFiles: (...args) => renderFiles(...args),
    navigate: (...args) => navigate(...args),
    openPreview: (...args) => openPreview(...args),
    setFileFollow: (...args) => setFileFollow(...args),
    follow, term: termProxy, mona, crepe, runtime, guardDirty, dirOf, fmtSize, escapeHtml,
    ic, svgWrap, SVG,
    showPreviewPanel: (...args) => showPreviewPanel(...args),
    renderPreviewFoot: (...args) => renderPreviewFoot(...args),
    renderPreviewActions: (...args) => renderPreviewActions(...args),
    isFav, renderBreadcrumb: (...args) => renderBreadcrumb(...args),
    renderTextPreview: (...args) => renderTextPreview(...args), isMdName,
    closePreview: (...args) => closePreview(...args), lightbox: (...args) => lightbox(...args),
    enterImageEdit: (...args) => enterImageEdit(...args),
    refreshGitStatus: (...args) => gitPanel?.load(...args),
  }));
  ({
    navigate, updateWatches, shQuote, goBack, goUp, render, renderBreadcrumb, visibleEntries,
    renderStatusbar, renderFiles, makeDraggablePath, applySelection, moveCursor, cursorEnter,
    dropFilesInto, dropUrlInto,
  } = createFileBrowserController({
    $, guardDirty, follow,
    restoreFileAreaIfHidden: (...args) => restoreFileAreaIfHidden(...args),
    api, toast, state, renderRootsActive: (...args) => renderRootsActive(...args), renderProjectRunActions: (...args) => projectRun?.render(...args), term: termProxy,
    openPreview: (...args) => openPreview(...args), setFileFollow: (...args) => setFileFollow(...args),
    recordRecent, toggleFav, iconSvg, fmtSize, fmtTime, isFav, escapeHtml, openWith,
    showContextMenu, baseOf, ic, svgWrap, SVG, diskPanel, refresh,
    kindFromName, setPreviewMax: (...args) => setPreviewMax(...args), fileList: fileListService,
    loadGitStatus: (...args) => gitPanel?.load(...args),
    renderGitStatus: (...args) => gitPanel?.render(...args),
  }));
  ({
    openPreview, showDiff, renderTextPreview, fsUrl, renderPreviewActions, renderPreviewFoot, closePreview, lightbox,
    applyLayout, bindSelectionToTerminal, enableTooltips, bindSidebarResizer, applyPreviewSize,
    animateLayout, restoreFileAreaIfHidden, showPreviewPanel, setPreviewMax, isPreviewMax, toggleSidebar,
  } = createPreviewController({
    $, state, runtime, guardDirty, mona, crepe, follow,
    setFileFollow: (...args) => setFileFollow(...args), api, fmtSize, escapeHtml, applySelection,
    term: termProxy, toast, enterEditMode, enterImageEdit: (...args) => enterImageEdit(...args),
    openWith, copyPath, ic, isHtmlName, iconSvg, fmtTime, isMdName,
  }));
  gitPanel = createGitPanel({
    $, api, ic, kindFromName, toast,
    showDiff: (...args) => showDiff(...args),
  });
  term = createTerminalController({
    $, state, follow, openWith, applyPreviewSize, animateLayout, updateWatches, escapeHtml, ic,
    baseOf, dirOf, navigate, renderBreadcrumb, playChime, toast, TERM_LINK_RE_BARE, api, apiPost,
    shQuote, applySelection, openPreview, recordRecent,
    codexResumeLast: (...args) => codexResumeLast(...args), setPreviewMax, isMdName, isHtmlName,
    popupMenu, rippleFileArea, confirmDialog, createTerminalShortcutActions,
  });
  term.bindDesktopEvents();
  ({ setFileFollow, rememberFollowChange, followChange } = createFileFollowController({
    $, state, follow, term, api, openPreview, navigate, renderFiles, refresh, applySelection,
    renderPreviewFoot, renderPreviewActions, showPreviewPanel, fsUrl, escapeHtml, iconSvg, fmtSize,
    baseOf, dirOf, toast, mona, crepe, playChime, rippleFileArea, kindFromName, isNoisyChange,
    runtime, selfOpened, isMdName, openWith,
  }));
  ({ enterImageEdit, undoImage } = createImageEditor({
    $, state, follow, setFileFollow, guardDirty, recordRecent, mona, crepe, showPreviewPanel,
    applySelection, renderPreviewFoot, toast, openPreview, inputDialog, confirmDialog, apiPost,
    baseOf, refresh, runtime,
  }));
  ({
    loadRoots, renderRootsActive, loadFavorites, renderFavs, loadCodexProjects, showCodexProjectMenu, openFavoriteFile,
  } = createSidebarController({
    $, api, apiPost, state, SVG, svgWrap, escapeHtml, dirOf, navigate, makeDraggablePath,
    openPreview, renderFiles, toggleFav, toast, confirmDialog, popupMenu,
    codexProjects: codexProjectsService, favorites: favoritesService, roots: rootsService,
  }));
  projectRun = createProjectRunController({
    $, state, api, apiPost, term, inputDialog, popupMenu, toast, ic,
    setRunningRoots: (roots) => codexProjectsService.setRunningRoots(roots),
  });
  projectRun.startPolling();
  cmdk = createCommandPalette({
    $, api, state, tilde, iconSvg, escapeHtml, openWith, navigate, recordRecent, dirOf,
    openPreview, renderFiles,
  });
  ({
    maybeShowGuide, bindResizer, bindTerminalResizer, bindCodexControls, bindEvents,
    applyTheme, codexResumeLast,
  } = createUiController({
    $, state, term, cmdk, toast, goBack, goUp, renderFiles, openPreview, closePreview,
    toggleSidebar, applyPreviewSize, setFileFollow, follow, doCreate, doTrash, doRename,
    diskPanel, popupMenu, mona, svgWrap, SVG, openWith,
    playChime, shotTray, dropFilesInto, dropUrlInto, runtime, undoImage, isPreviewMax,
    setPreviewMax, moveCursor, cursorEnter, toggleFav,
    setThemeControlValue: (value) => themeControl?.setValue(value),
  }));
  setupSegmentedControls();
}


// 终端渲染器诊断开关：codexboxWebgl(false) 关 WebGL 用 DOM renderer 排查 CJK 残影，codexboxWebgl(true) 恢复。
// 与设置面板「WebGL 加速渲染」同一逻辑，对所有已开标签立即生效
window.codexboxWebgl = (on) => { term.setWebgl(!!on); console.log('[codexbox] WebGL ' + (on ? '已开启' : '已关闭（DOM renderer 兼容渲染）') + '，已对所有终端标签生效'); return !!on; };

setupControllers();
startApplication({
  $, state, applyTheme, applyLayout, term, bindEvents, bindResizer, bindSidebarResizer,
  bindSelectionToTerminal, enableTooltips, loadRoots, loadFavorites, loadCodexProjects,
  navigate, maybeShowGuide, escapeHtml, toast,
  recoveryDialog,
  refreshGitStatus: (...args) => gitPanel?.refresh(...args),
});
