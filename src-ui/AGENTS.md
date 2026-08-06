# src-ui/
> L2 | 父级: ../AGENTS.md

## 成员清单
GitPanel.svelte: Svelte 5 Git 状态界面岛，常驻渲染分支名、按需显示变更汇总，并通过 body portal 定位文件弹层
DialogHost.svelte: Svelte 5 通用弹窗宿主，串行处理输入、确认和终端恢复选择请求、键盘与焦点
ContextMenu.svelte: Svelte 5 上下文菜单宿主，管理动作列表、视口定位、外部点击、窗口失焦与 Escape 关闭
DiskPanel.svelte: Svelte 5 磁盘透视界面岛，管理异步加载、错误态、占用条和目录下钻
CodexProjects.svelte: Svelte 5 Codex 项目列表界面岛，管理项目渲染、活动目录、相对时间与顶层运行服务状态
ProjectDirectory.svelte: Codex 项目列表的递归目录节点，懒加载子目录并提供导航、拖拽、顶层菜单与单项目运行服务指示
codex-projects-service.js: Codex 项目列表适配入口，连接目录 API、侧边栏动作、运行服务状态与 Svelte 组件
FavoritesList.svelte: Svelte 5 收藏列表界面岛，渲染目录/文件收藏并复用递归目录节点
favorites-service.js: 收藏列表适配入口，连接目录 API、导航预览与收藏移除动作
RootsList.svelte: Svelte 5 快速入口界面岛，复用递归目录节点渲染根目录树
roots-service.js: 快速入口适配层，连接根目录数据、目录 API 与导航拖拽动作
FileList.svelte: Svelte 5 主文件列表界面岛，声明式渲染网格/列表、缩略图、变更热度、收藏和选择状态
file-list-service.js: 主文件列表适配层，同步提交视图模型并提供选择、游标和网格列数接口
SegmentedControl.svelte: Svelte 5 通用受控按钮组，统一等宽布局、选中态、焦点和方向键操作
segmented-control-service.js: 通用按钮组适配入口，按原生目标容器挂载 Svelte 组件
context-menu-service.js: 上下文菜单适配入口，向原生控制器保留 popupMenu/closeContextMenu 接口
disk-panel-service.js: 磁盘透视适配入口，连接 du API、路径工具与 Svelte 组件
dialog-service.js: 通用弹窗适配入口，向原生控制器暴露输入、确认和终端恢复 Promise 接口
git-panel.js: Git 面板适配入口，连接 HTTP/Diff 能力与 Svelte 生命周期，提供静默刷新和同目录并发保护
index.js: Svelte 界面统一构建入口，导出全部界面岛服务并共享运行时

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
