/**
 * [INPUT]: 依赖 Git、弹窗、菜单、侧边栏与主文件列表界面岛适配器
 * [OUTPUT]: 对外统一导出全部 Svelte 界面岛服务
 * [POS]: src-ui 的浏览器构建入口，保证多个界面岛共享一份 Svelte 运行时
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
export { createGitPanel } from './git-panel.js';
export { createDialogService } from './dialog-service.js';
export { createContextMenuService } from './context-menu-service.js';
export { createCodexProjectsService } from './codex-projects-service.js';
export { createFavoritesService } from './favorites-service.js';
export { createRootsService } from './roots-service.js';
export { createFileListService } from './file-list-service.js';
export { createSegmentedControlService } from './segmented-control-service.js';
