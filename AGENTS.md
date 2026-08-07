# Mado - Codex 与 Pi 的本地桌面驾驶舱
Electron 33.4.11 + Node.js >=22 + Svelte 5.56.4 + xterm.js 6.0.0 + node-pty 1.1.0 + HTML/CSS/JavaScript

<directory>
assets/ - README 与宣传页使用的产品截图和横幅
build/ - macOS 应用图标、权限与签名资源
docs/ - 产品、架构、验收与故障记录
electron/ - Electron 主进程、预加载安全桥接和桌面系统能力
experiments/ - 可独立执行的回归验证与技术实验
.github/ - GitHub Actions 纯测试持续集成配置
public/ - 浏览器渲染层、样式和本地 vendor 资源
server/ - 本地服务领域模块，承载配置、路径和手动项目能力
src-vendor/ - vendor 浏览器包的 esbuild 源入口
src-ui/ - Svelte 渐进式界面岛与原生控制器适配入口
tests/ - Node 内置自动化测试，覆盖服务端高风险逻辑与渲染层控制器行为
</directory>

<config>
.gitattributes - 生成 Svelte 模块的差异检查规则，保留运行时有意的空白字符字面量
package.json - Mado 桌面入口、依赖版本、二进制依赖安装许可、测试检查和构建发布脚本
package-lock.json - npm 依赖锁文件
port-config.js - 正式/开发端口常量、合法范围及 MADO_PORT/MADO_DEV_PORT 环境隔离的唯一真源
server.js - 本地 HTTP 文件服务、配置驱动的手动项目 API、mado CLI 入口，按 --dev 选择端口模式
build/entitlements.mac.plist - macOS 签名和 hardened runtime 权限
</config>

<verification>
界面与交互验收禁止代理启动浏览器、Playwright 或其他浏览器自动化工具。
界面与交互一律由用户手动验证；代理完成代码、构建和自动化测试后，只提供明确可执行的手动验证步骤。
</verification>

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
