<!--
[INPUT]: 依赖 Mado 已登记项目、Electron 主进程、Pi 0.85.1+ 官方 RPC、Discord Bot Gateway
[OUTPUT]: 对外提供第一版 Discord 远程 Pi 功能边界、配置方法、命令、错误收集和后续路线
[POS]: docs 的 Discord 远程控制方案，约束单用户、单项目新会话、结果通知与安全边界
[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
-->
# Discord 远程 Pi（第一版）

## 目标

Discord 只是远程聊天入口。用户在 Discord 中选择 Mado 已登记的项目，Mado 在本机为该项目启动一个全新的 Pi RPC 进程；Thread 中的普通消息会成为 Pi 的新任务，Discord 只显示关键状态和最后的执行总结。

```text
Discord Thread → Electron 主进程 → pi --mode rpc → 指定项目目录
```

## 第一版边界

- 只支持 Pi，不支持 Codex 或多 Agent。
- 只支持单个配置的 Discord 用户、服务器和频道。
- `/new project:<项目名>` 每次创建新的 Discord 子区和持久 Pi 会话；同一子区永远绑定原项目与原 Pi Session，不换绑、不复用。
- Mado 重启后不启动全部历史 Pi；子区收到消息或 `/result` 时才按需恢复绑定的 Pi Session。
- 项目只能来自 Mado 的 `~/.mado/config.json` 项目列表，Discord 不能传本机路径。
- 普通消息直接发送给当前 Thread 的 Pi；同一会话上一轮未结束时拒绝新消息。
- 只发送启动、处理中、完成、失败等关键消息，不发送思考、工具调用、完整终端输出或文件内容。
- Pi 通过官方 `--mode rpc` JSONL 协议运行；不使用 Pi SDK，不读取 `~/.pi/agent/`。
- 使用 Pi 的原有权限和项目安全设置，不传 `--approve`，不提供远程 Shell 或远程批准。
- Mado 退出时关闭 Discord Bot 和当前远程 Pi；运行中的文件不会自动回滚。历史绑定不启动，下一次使用时按原 session 恢复。
- Discord 断线、Bot 启动失败或 RPC 出错时，Mado 本地功能继续运行。

## Discord 命令

| 命令 | 作用 |
| --- | --- |
| `/new project:mado` | 创建新的 Pi Thread，项目名必须与 Mado 项目 basename 相同 |
| `/status` | 查看当前 Thread 的项目、Pi 和状态 |
| `/result` | 重新显示当前会话最后一次执行总结 |
| `/stop` | 终止当前 Thread 的 Pi，但保留项目与 Pi Session 绑定 |
| Thread 普通消息 | 向当前 Pi 发送一条新任务 |

第一版使用者只有配置中的 `DISCORD_OWNER_USER_ID`。Bot 只接受配置中的 `DISCORD_GUILD_ID` 和 `DISCORD_CHANNEL_ID`；Thread 中的命令要求其父频道匹配入口频道。

## 配置

Discord 默认关闭。启动 Mado 前设置：

```bash
export MADO_DISCORD_ENABLED=1
export DISCORD_BOT_TOKEN='只放在本机，不要提交到 Git'
export DISCORD_GUILD_ID='服务器 ID'
export DISCORD_CHANNEL_ID='入口频道 ID'
export DISCORD_OWNER_USER_ID='你的用户 ID'
export MADO_DISCORD_PI_PATH="$(which pi)"
npm run app
```

也可将非密钥字段写入 `~/.mado/discord.json`：

```json
{
  "enabled": true,
  "guildId": "服务器 ID",
  "channelId": "入口频道 ID",
  "ownerUserId": "你的用户 ID",
  "piPath": "/绝对路径/到/pi"
}
```

会话绑定保存在 `~/.mado/discord-sessions.json`，Pi Session 文件保存在 `~/.mado/discord-sessions/`。这里只保存 Thread、项目和 Pi Session 地址，不保存 Discord 历史或任务正文；Mado 重启后只在对应子区再次使用时恢复 Pi。

Token 可放在 `~/.mado/discord-token`，文件必须是本人拥有的普通文件且权限为 `600`。环境变量优先于文件。Token 只在 Electron 主进程读取，不会进入渲染层或传给 Pi；Mado 启动时会从 Agent 环境中移除 `DISCORD_*` 和 `MADO_*` 变量。

Bot 需要 Discord 的 `View Channel`、`Send Messages`、`Create Public Threads`、`Send Messages in Threads` 权限，并在 Developer Portal 开启 Message Content Intent。Slash Command 使用 Guild Command，启动后立即注册。

## 运行方式

每个 Discord Thread 都对应一个持久绑定、按需启动的会话：

```text
threadId → sessionId → Pi RPC 子进程
```

Pi 启动参数：

```text
pi --mode rpc --session-dir ~/.mado/discord-sessions --append-system-prompt <远程任务规则>

恢复已有会话时使用 `--session <已保存的 sessionFile>`。每个 sessionFile 同时只能被一个 Pi 进程打开；发现旧锁或孤儿进程时宁可拒绝重复启动并记录错误，也不冒险破坏会话文件。
```

RPC 最终消息使用 `message_end` 的 assistant 文本，使用会话级 `agent_settled` 判断本轮结束；不依赖终端提示符、ANSI 输出或关键词。思考内容、工具开始/过程和工具参数不转发。Pi 扩展如果要求 `confirm/select/input/editor`，第一版不支持远程交互，会终止会话并报告错误编号。

## 错误收集

日志目录为 Mado userData 下的 `discord-logs/events.jsonl`，单文件 2 MiB，最多轮转两个旧文件。每条记录包含：

- ISO 时间、Mado 运行 ID、错误编号或事件代码。
- Discord Thread/会话 ID（不记录任务正文）。
- Pi 启动、RPC、退出、重试、工具结束和 Discord 发送事件。
- 错误名称、系统错误码、有限长度消息和堆栈。

日志自动脱敏：Bot Token、API Key、Bearer/私钥、Webhook 凭据、用户主目录会被替换。不会记录完整 prompt、思考、工具参数、文件内容或完整 Pi 输出。错误回复只给 Discord 一个短错误编号，例如 `a1b2c3d4`。

常见编号：

| 编码 | 含义 |
| --- | --- |
| `DISCORD_START_FAILED` | Bot 登录或命令注册失败 |
| `DISCORD_SEND_FAILED` | Discord 回复失败 |
| `PI_START_FAILED` | Pi 路径、项目或模型启动失败 |
| `PI_PROTOCOL_INVALID` | Pi stdout 不是合法 JSONL |
| `PI_INTERACTION_REQUIRED` | Pi 扩展要求第一版未实现的远程交互 |
| `PI_PROMPT_FAILED` | 任务未被 Pi 接受 |
| `PI_NO_FINAL_RESULT` | Pi 结束但没有可用最终回复 |
| `PI_TURN_TIMEOUT` | 单轮超过 30 分钟 |
| `PI_EXIT_UNEXPECTED` | Pi 意外退出 |

提供错误信息时请同时给出：Mado 版本、错误编号、Discord 显示文字和 `discord-logs/events.jsonl` 中对应时间附近的记录；不要发送 Bot Token 或完整日志中的敏感内容。

## 待实现

- Codex 适配器和统一 Agent 选择。
- 多用户、角色权限和按项目授权。
- Discord 历史消息自动摘要（Pi Session 恢复已在第一版支持）。
- 断线后任务结果补发和可靠消息队列。
- Discord 中的人工确认、Pi 扩展 UI 映射和安全审批流程。
- Git diff 摘要、文件变更摘要、截图和结果附件。
- Discord 配置界面、Keychain/safeStorage Token 管理和 Bot 连接状态 UI。
- 独立后台 Worker、Git worktree、任务队列与更强的操作系统隔离。

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
