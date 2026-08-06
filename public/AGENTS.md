# public/
> L2 | 父级: ../AGENTS.md

## 成员清单
app.js: 原生 ES Module 渲染层主入口，编排文件管理、Git 查看、预览编辑、内嵌 xterm、项目运行命令、选择性命令恢复、终端快捷动作、Codex 项目会话与全局交互
i18n-dict.js: 中文源文案到英文的静态词典与动态规则集合，覆盖使用指南、终端反馈与项目运行命令并导出 MADO_DICT 和 MADO_DICT_RULES
i18n.js: 保留中文原文缓存的 MutationObserver 国际化运行层，原地双向翻译界面、持久化语言并同步 Electron 菜单
index.html: 单页应用文件区、顶栏项目运行动作、主题化隐藏文件控件、使用指南入口、预览区与终端区 DOM 骨架及本地 vendor 脚本加载顺序
styles/: 按级联顺序拆分的主题、布局、预览、弹层、终端与文件跟随样式
modules/: 渲染层原生 ES Modules，按图标、状态、文件、预览、终端与文件跟随职责拆分
generated/: 由 build/svelte-ui.mjs 生成的 Svelte 离线浏览器模块
assets/: 渲染层使用的 Codex 图标等静态资源，入口图标为 codex.svg
vendor/: xterm、Monaco、Milkdown、highlight.js 等离线浏览器依赖

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
