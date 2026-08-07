# build/
> L2 | 父级: ../AGENTS.md

## 成员清单
after-pack.js: electron-builder macOS 打包后钩子，在签名前恢复 node-pty spawn-helper 可执行位并拒绝缺失产物
entitlements.mac.plist: macOS hardened runtime 权限配置，允许 node-pty 原生模块按签名策略运行
icon-1024.png: 当前 macOS 应用图标的 1024 像素源图，由用户提供的 Mado 窗格终端图生成
icon.icns: electron-builder 使用的当前 macOS ICNS 应用图标
icon.png: Electron 开发模式 Dock 使用的当前 512 像素 PNG 图标
icon-1024.legacy-box.png: 更换前的 1024 像素盒子图标备份，不参与构建
icon.legacy-box.png: 更换前的 512 像素 Dock 盒子图标备份，不参与构建
icon.legacy-box.icns: 更换前的 macOS 盒子 ICNS 备份，不参与构建
icon-design.legacy-box.html: 更换前的 Mado 盒子图标 HTML 设计稿备份
logo.legacy-box.svg: 更换前的侧边栏与使用指南单色盒子 Logo 备份
node-pty-permissions.js: 本地安装与发布打包共享的 macOS spawn-helper 权限修复单一真源
prepare-electron.mjs: npm postinstall 的 Electron 幂等准备器，在 Node 26 半安装时使用官方校验下载与 ditto 补全 Electron.app
prepare-node-pty.js: npm postinstall 本地依赖准备入口，保证开发环境 PTY 辅助程序可执行
dev.mjs: 开发监督入口，监听 Svelte/渲染层源码并安全刷新界面，监听服务端/Electron 源码并安全重启应用
svelte-ui.mjs: esbuild + esbuild-svelte 界面构建配置与正式构建入口，将 src-ui 编译为 public/generated 离线模块

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
