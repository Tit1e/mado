<!--
[INPUT]: 依赖 Codex/Pi CLI、Mado 手动项目配置和内嵌真实终端
[OUTPUT]: 对外提供 Codex/Pi 第一方启动能力与 Agent 无关项目列表的产品技术边界
[POS]: docs 的 Agent 集成边界文档，约束启动、项目归属、文件联动、信任和旧偏好兼容策略
[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
-->
# Agent 集成边界

> 状态：Mado 第一方快速启动支持 Codex 与 Pi，其他程序仍可在真实终端中手动运行。

## 当前能力

- 一键启动：终端工具栏分别提供 Codex 与 Pi 图标，始终在左侧当前目录创建新终端标签。
- 通用偏好：终端设置只提供一个“继续最近会话”开关。开启时 Codex 执行 `codex resume --last`、Pi 执行 `pi -c`；关闭时分别执行 `codex`、`pi`。
- 原生菜单：Codex 与 Pi 均提供按通用偏好启动和强制新建会话两个动作；现有 Codex 快捷键保持不变，Pi 第一版不占用新的全局快捷键。
- 项目归属：项目由用户通过桌面原生目录选择器手动添加，持久化在 `~/.mado/config.json`，不读取任何 Agent 会话记录。
- 文件联动：文件跟随、预览、改动反馈、提示音和完成通知使用通用 Agent 语义，不依赖特定 Agent 的私有数据。

## Pi 边界

Mado 只向真实 Shell 写入 Pi 官方 CLI 命令，不链接 Pi SDK，也不读取 `~/.pi/agent/`。Pi 的登录、模型、Provider、Thinking Level、Skills、扩展、项目信任和联网行为继续由 Pi 自己管理。Mado 不自动传入 `--approve`，不绕过 Pi 的项目安全提示。

Pi 未安装、未登录、离线或上游命令失败时，错误由终端原样显示。Mado 不自动安装、更新或修复 Pi，也不会影响 Codex 和本地项目配置。

## 通用终端边界

内嵌终端仍是真实 Shell。用户可以手动运行 `git`、`vim`、构建命令和其他 Agent。第一方集成只定义工具栏与菜单中的固定启动动作，不给 Shell 增加命令黑名单。

## 兼容处理

通用偏好写入 `mado_agent_resume_last`。该键尚未写入时，读取已发布的 `mado_codex_resume_last` 作为回退，保留原有 Codex 用户的选择；旧键不主动删除。

`~/.mado/config.json` 里的 `enabledAgents`、`agents` 和 `organizeEngine` 字段仍不读取。Mado 保存其他配置时继续按未知字段原样保留。

## 不做

- 不恢复可编辑的 Agent 注册表、安装探测、启用开关或自定义启动命令。
- 不扫描 Codex、Pi、Claude Code 或其他 Agent 的会话来生成项目列表。
- 不扫描任何 Agent 的 Skills、扩展、模型、用量或凭据。
- 不提供 Pi 历史会话选择入口；用户可进入 Pi 后使用 `/resume`。
- 不提供最近项目导入或一键添加当前目录。
- 不阻止用户在通用终端里手动执行普通命令。
