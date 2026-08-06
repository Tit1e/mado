<!--
[INPUT]: 依赖 Codex CLI、~/.codex/sessions 会话目录和 CodexBox 内嵌终端
[OUTPUT]: 对外提供 CodexBox 只集成 Codex 的产品与技术边界
[POS]: docs 的 Codex 单一 Agent 边界文档，约束启动、项目发现、文件联动和旧配置兼容策略
[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
-->
# Codex 单一 Agent 边界

> 状态：自 2026-07 起，CodexBox 的第一方 Agent 能力只支持 Codex。

## 当前能力

- 一键启动：终端顶栏默认执行 `codex resume --last`，继续当前终端目录最近的会话；用户可在终端设置中取消勾选，改为执行 `codex` 新建会话。不再提供 Agent 注册表、启用开关或自定义启动命令。
- 项目发现：只扫描 `~/.codex/sessions` 中最近 30 天的会话，从 `cwd` 提取项目路径。
- 文件联动：文件跟随、预览与通知都以 Codex 工作流为产品语义。

## 通用终端边界

内嵌终端仍是真实 shell。用户可以手动运行 `git`、`vim`、构建命令和其他普通程序；Codex-only 约束的是 CodexBox 主动提供的 Agent 集成，不是给 shell 增加命令黑名单。

## 兼容处理

`~/.codexbox/config.json` 里的 `enabledAgents`、`agents` 和 `organizeEngine` 字段不再读取。CodexBox 保存其他配置时仍按未知字段原样保留。

## 不做

- 不恢复多 Agent 选择器、安装探测和自定义 Agent 注册表。
- 不扫描其他 Agent 的会话、Skills、用量或凭据。
- 不阻止用户在通用终端里手动执行普通命令。
