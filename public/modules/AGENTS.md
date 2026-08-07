# modules/
> L2 | 父级: ../AGENTS.md

## 成员清单
agent-launcher.js: Codex/Pi 第一方启动命令唯一真源，只接受继续与新建两个固定动作
command-palette.js: 全局命令面板控制器，提供文件名模糊搜索、内容搜索和结果导航
edit-session.js: 编辑会话安全守卫，统一处理自动保存、未保存确认和状态清理
editors.js: Monaco 与 Milkdown Crepe 编辑器适配工厂，集中处理加载、主题、语言和资源释放
effects.js: 文件变更噪声过滤、项目类型识别、涟漪反馈与 Agent 提示音效果
file-follow.js: Agent 文件跟随控制器，管理目标选择、实时代码/Markdown/HTML 渲染和变化反馈
file-browser.js: 文件浏览控制器，管理目录导航、文件视图模型、Git 在上数量在下的双行状态栏、选择、拖放与键盘移动
file-actions.js: 文件动作控制器，管理文本编辑、文件变更、文件夹添加项目和开发工具面板，输入、确认与上下文菜单复用 Svelte 服务
icons.js: 文件类型与界面 SVG 图标工厂，提供富图标、通用图标和终端文件链接规则
image-editor.js: Canvas 图片编辑控制器，提供标注、打码、缩放、格式转换和安全保存
lifecycle.js: 应用生命周期控制器，完成界面初始化、Git 五秒轮询、首批数据加载、终端恢复和更新提示绑定
preview.js: 文件预览与布局控制器，管理内容预览、单文件 Git Diff、动作栏、终端浮层覆盖与全屏状态
project-run.js: 项目运行命令控制器，管理规则继承、顶栏动作、隐藏服务 PTY 与项目运行状态
sidebar.js: 侧边栏领域控制器，统一管理目录选择/右键路径添加、去重反馈、移除及根目录收藏，三个列表渲染委托 Svelte 服务
terminal.js: 终端领域控制器，管理多标签 PTY、隐藏项目服务会话、命令恢复、Codex/Pi 启动、文件拖放和停靠布局，保持不超过 800 行
terminal-agent-status.js: 终端 Agent 状态子控制器，管理忙闲判断、提示音、完成通知和回复摘要
terminal-shortcuts.js: 终端快捷动作控制器，统一处理活动标签关闭保护、命令重启并发保护和 Codex/Pi Electron 事件绑定
ui-controller.js: 界面编排控制器，管理全局事件、文件区空白添加项目菜单、主题、尺寸拖拽、终端设置、首次引导和手动重开指南

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
