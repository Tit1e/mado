<!--
[INPUT]: 依赖 package.json 构建脚本、electron/main.js 系统集成和 server/ 领域服务的平台分支
[OUTPUT]: 对外提供 Intel Mac 与 Windows 的当前移植状态、剩余风险和执行清单
[POS]: docs 的平台评估文档，为构建与兼容性决策提供边界
[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
-->
# 10 · 跨平台移植评估：Windows / Intel Mac

> 初稿写于 2026-06-18，2026-07 按当前代码修订。Mado 的主力验证平台仍是 macOS。

## 结论先行

| 目标平台 | 状态 | 一句话 |
|---------|------|--------|
| **Intel Mac（x64 darwin）** | 已有构建入口 | `npm run dist:x64` 会重编 x64 node-pty、打包后再恢复本机架构，剩余工作是持续真机验收。 |
| **Windows** | 未完整支持 | 文件路径已有部分分支，但系统命令、凭据、截图、电源管理和 ConPTY 仍需逐项适配。 |

Intel Mac 不再是架构项目；Windows 应作为独立兼容性项目推进，先验证 CLI 和 ConPTY，再补系统集成。

---

## 一、Intel Mac（x64 darwin）

Electron 和 Node 的系统 API 在两种 Mac 架构上基本一致，关键差异是原生模块：

- `package.json` 已提供 `dist:x64`，先按 x64 重编 node-pty，再让 electron-builder 输出 x64 dmg。
- `electron/main.js` 在 node-pty 未就绪时会降级，应用不会直接崩溃，但终端不可用，因此发布前必须在 Intel 真机验证 PTY 启动、输入、resize 和退出。

---

## 二、Windows 的剩余工作

### 1. 服务端命令仍带 POSIX 假设

- `server/developer-tools.js` 与 `server/file-service.js` 的命令探测仍带 POSIX shell 假设，另有 `du` 调用；这些需要统一的平台适配层。
- 打开终端、移到废纸篓等流程已有 Windows 分支，但需要真机验证 PowerShell 参数、带空格路径和中文路径。
- macOS Keychain、`scutil --proxy` 与系统代理读取不能直接复用到 Windows，凭据和代理必须采用 Windows 原生来源。

### 2. Electron 系统能力是 macOS 优先

- 截图监听依赖 macOS 截图目录和系统事件，Windows 需要独立实现或明确降级。
- 合盖继续运行依赖 `pmset`、`visudo` 与 `osascript`；Windows 应使用系统电源 API，并尊重用户的合盖电源计划。
- 文件剪贴板当前通过 AppleScript 写入，Windows 需要对应的 Electron 或系统实现。

### 3. node-pty 在 Windows 使用 ConPTY

`electron/main.js` 已会为 Windows 选择 PowerShell，但 ConPTY 的输入、resize、中文、IME、前台进程识别与退出行为都必须单独验收，不能从 macOS 结果外推。

### 4. 上游 CLI 是不可控项

Codex 在 Windows 的安装、凭据和会话行为由上游决定。应先用目标版本做最小真机探针；如果 CLI 自身不稳定，Mado 只能如实降级，不能在应用层掩盖。

---

## 三、合盖继续运行的产品边界

该能力服务于本机长任务，不再与任何远程消息入口绑定：

- **Intel Mac**：继续使用 `pmset`，但必须保证应用退出和终端全部结束时恢复正常休眠。
- **Windows**：优先使用系统电源 API；合盖动作由电源计划控制，Mado 不应擅自永久修改用户设置。

如果目标变成 7×24 小时运行，稳定方案是使用不会休眠的常驻机器，而不是持续绕过笔记本电源管理。

---

## 四、Windows 移植清单

1. 先验证目标版本的 Codex 与 node-pty/ConPTY 基础链路。
2. 为 `server/developer-tools.js`、`server/file-service.js` 收敛命令探测的平台适配层。
3. 补齐打开、废纸篓、剪贴板、截图和电源管理的 Windows 实现或明确降级。
4. 覆盖中文路径、空格路径、IME、resize、长输出和进程退出。
5. 建立 Windows 打包、安装、升级与回归验收流程，再声明正式支持。
