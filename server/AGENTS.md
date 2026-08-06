# server/
> L2 | 父级: ../AGENTS.md

## 成员清单
app-server.js: 主应用 HTTP 路由装配器，集中映射文件、配置、开发工具与 Codex 会话 API
codex-sessions.js: Codex 会话服务，扫描项目会话并通过官方 CLI 执行带快照和运行态保护的归档/删除
browser-service.js: 只读文件浏览与搜索服务，提供目录列表、文件读取、模糊搜索、grep 与 Spotlight 搜索
config-store.js: 配置存储服务，提供容错读取、串行读改写和 fsync+rename 原子持久化
developer-tools.js: 开发者工作流服务，提供 Codex CLI 定位
file-service.js: 可变文件操作服务，提供原子写、废纸篓、移动/创建、终端路径定位、图片保存与系统打开
git-service.js: 只读 Git 服务，提供仓库分支、变更文件、增删行汇总与单文件 HEAD Diff
http-security.js: HTTP 安全与协议基础设施，提供 Host/Origin 校验、请求体限制和 JSON 响应
media-service.js: 媒体与静态响应服务，提供压缩包、缩略图、HEIC、Range 原始文件和 HTML 预览
path-service.js: 服务端路径与文件类型基础能力，集中维护扩展名分类、MIME 和路径规整
preview-server.js: 隔离预览 HTTP 服务，只允许主目录非点路径的 GET/HEAD 静态访问
run-rule-service.js: 项目运行规则服务，原子保存带稳定 ID 的单目录命令、支持移除并按最长祖先目录解析继承规则

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
