<!--
[INPUT]: 依赖 Codex CLI、Mado 手动项目配置和内嵌终端
[OUTPUT]: 对外提供 Mado 第一方 Codex 能力与 Agent 无关项目列表的产品技术边界
[POS]: docs 的 Codex 单一 Agent 边界文档，约束启动、项目归属、文件联动和旧配置兼容策略
[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
-->
# Codex 单一 Agent 边界

> 状态：自 2026-07 起，Mado 的第一方 Agent 能力只支持 Codex。

## 当前能力

- 一键启动：终端顶栏默认执行 `codex resume --last`，继续当前终端目录最近的会话；用户可在终端设置中取消勾选，改为执行 `codex` 新建会话。不再提供 Agent 注册表、启用开关或自定义启动命令。
- 项目归属：项目由用户通过桌面原生目录选择器手动添加，持久化在 `~/.mado/config.json`；不读取 Codex、Pi、Claude Code 或其他 Agent 的会话记录。
- 文件联动：文件跟随、预览与通知当前仍以 Codex 工作流为产品语义，项目列表本身不绑定 Agent。

## 通用终端边界

内嵌终端仍是真实 shell。用户可以手动运行 `git`、`vim`、构建命令和其他普通程序；Codex-only 约束的是 Mado 主动提供的 Agent 集成，不是给 shell 增加命令黑名单。

## 兼容处理

`~/.mado/config.json` 里的 `enabledAgents`、`agents` 和 `organizeEngine` 字段不再读取。Mado 保存其他配置时仍按未知字段原样保留。

## 不做

- 不恢复多 Agent 选择器、安装探测和自定义 Agent 注册表。
- 不扫描任何 Agent 的会话来生成项目列表，也不扫描其他 Agent 的 Skills、用量或凭据。
- 不提供最近项目导入或一键添加当前目录。
- 不阻止用户在通用终端里手动执行普通命令。
