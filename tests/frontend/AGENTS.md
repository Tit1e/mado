# tests/frontend/
> L2 | 父级: ../AGENTS.md

## 成员清单
controller-contracts.test.mjs: 渲染层控制器与终端快捷动作工厂的公开接口契约测试
context-menu-service.test.mjs: Svelte 上下文菜单测试，覆盖视口定位、危险项、动作执行与关闭路径
codex-projects.test.mjs: Svelte Codex 项目列表测试，覆盖活动高亮、目录展开、导航与菜单转发
dialog-service.test.mjs: Svelte 通用弹窗测试，覆盖输入、确认、终端恢复选择、焦点、键盘与请求串行
dom-environment.mjs: happy-dom 全局环境安装与清理辅助工具，覆盖原生控制器和 Svelte 运行时 DOM 构造器
editor-guard.test.mjs: 自动保存、未保存确认、预览关闭与编辑器资源释放测试
file-follow.test.mjs: 文件跟随启停、终端绑定与手动导航接管测试
favorites-list.test.mjs: Svelte 收藏列表测试，覆盖空态、目录/文件渲染、活动高亮、预览与移除动作
file-area-drop.test.mjs: 文件区列表交互测试，覆盖目录行拖放目标与单行键盘移动
file-list.test.mjs: Svelte 主文件列表测试，覆盖唯一列表视图、媒体缩略图回退、选择、索引主题对比度、变更标记、收藏及交互转发
git-panel.test.mjs: Svelte Git 常驻分支、按需汇总、静默刷新并发保护、非仓库提示与 Diff 跳转测试
i18n.test.mjs: 国际化原地双向切换、动态界面翻译、终端内容隔离与原生菜单同步测试
navigation.test.mjs: 文件浏览排序过滤与命令面板导航测试
project-run.test.mjs: 项目运行命令顶栏、继承规则与删除配置回归测试
resizer-style.test.mjs: 侧边栏、文件预览与终端分割线样式契约测试，覆盖命中区、方向映射与 1px 悬停线
roots-list.test.mjs: Svelte 快速入口测试，覆盖根目录渲染、活动高亮、目录展开与导航
sidebar.test.mjs: Codex 项目会话归档、删除和运行态保护业务测试
segmented-control.test.mjs: Svelte 通用按钮组测试，覆盖受控值、点击切换、方向键与无障碍状态
terminal-close.test.mjs: 终端快捷键与关闭测试，覆盖收起面板后新建、Codex 继续/无参数新建、当前命令重启、前台进程关闭确认、隐藏服务相邻标签关闭和桌面事件绑定
topbar-controls.test.mjs: 顶栏控件测试，覆盖隐藏文件复选框的原生语义、键盘焦点和三套主题视觉契约
ui-guide.test.mjs: 使用指南测试，覆盖核心工作流与快捷键双语内容、首次状态、手动重开、重复打开保护、终端按钮右侧位置和顶栏事件链

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
