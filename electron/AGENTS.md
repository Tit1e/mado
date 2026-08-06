# electron/
> L2 | 父级: ../AGENTS.md

## 成员清单
ipc-validation.js: Electron IPC 纯参数校验，约束 PTY、运行服务标识、拖入、监听和更新请求
file-watch-service.js: 文件监听领域服务，维护多目录 FSWatcher 集合并转发真实变更
dev-reload-service.js: 开发期刷新守卫，接收监督进程 IPC 控制消息，确认终端状态后刷新渲染层或以专用退出码重启应用
main.js: Electron 主进程编排入口，装配窗口、项目目录选择、可即时重建的双语菜单、Codex 新会话/命令重启快捷键、Shell/恢复/开发刷新领域服务、IPC 与应用生命周期，并仅在真实前台任务存在时确认退出
preload.js: contextBridge 安全桥接层，向渲染进程暴露项目目录选择、终端、Codex 继续/新建启动、当前命令重启、恢复、文件、剪贴板、拖拽、截图、更新、菜单语言与窗口事件的受控接口
power-service.js: 合盖运行状态服务，以用户意图和终端数量驱动系统休眠开关并处理失败回退
pty-service.js: PTY 领域服务，管理终端与带规则标识的隐藏服务会话、顶层命令追踪、安全重启、前台进程检测、运行任务快照与销毁
quit-service.js: 应用退出守卫，以 PTY 真实前台任务快照决定退出确认，并在确认后保存可恢复命令
shell-integration.js: zsh 隔离启动配置与 OSC 标记解析，安全继承嵌套 Mado 的原始 ZDOTDIR 并追踪顶层命令生命周期
terminal-recovery-store.js: 终端恢复 JSON 仓储，保留隐藏服务规则标识并提供安全校验、去重、目录检查、一次性取出与清空
system-file-service.js: 系统文件领域服务，处理图片/文件剪贴板和拖入文件安全落盘与复制

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
