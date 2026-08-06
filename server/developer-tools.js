/**
 * [INPUT]: 依赖 Node.js 子进程能力和 Codex CLI
 * [OUTPUT]: 对外提供 createDeveloperTools，封装 Codex CLI 定位
 * [POS]: server 模块的开发者工作流服务，被 Codex 会话服务消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const { execFile } = require('child_process');

function createDeveloperTools() {
  async function findCodexBin() {
    // GUI 启动的 app 没有用户 shell 的 PATH，走登录 shell 找一次绝对路径
    return new Promise((resolve) => {
      execFile('/bin/zsh', ['-lc', 'command -v codex'], { timeout: 8000 }, (err, stdout) => {
        const out = String(stdout || '').trim().split('\n').pop();
        resolve(!err && out && out.startsWith('/') ? out : null);
      });
    });
  }

  return { findCodexBin };
}

module.exports = { createDeveloperTools };
