# tests/server/
> L2 | 父级: ../AGENTS.md

## 成员清单
browser-service.test.js: 大文本读取截断与非文本文件元数据读取测试
config-store.test.js: 配置缺省、损坏拒绝、并发读改写与原子持久化测试
run-rule-service.test.js: 运行规则稳定标识、保存/移除、最长祖先目录继承、路径边界与非法输入测试
file-service.test.js: 临时目录中的原子写入、并发冲突、创建、移动、重命名、图片保存与废纸篓命令测试
git-service.test.js: 隔离临时仓库中的分支识别、变更文件和文本增删行汇总测试
http-security.test.js: 主 HTTP Host/Origin 防护、请求体上限与隔离预览路径边界测试
http-file-workflow.test.js: 随机本机端口上的完整文件和配置 HTTP 工作流测试，系统废纸篓以注入命令替身隔离
path-service.test.js: 路径规整、文件类型、JavaScript 模块 MIME 和项目类型推断测试
codex-sessions.test.js: Codex 新旧会话元数据、项目聚合和快照保护测试

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
