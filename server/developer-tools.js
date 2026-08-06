/**
 * [INPUT]: 依赖 Node.js 文件/进程能力、Codex CLI 和调用方路径解析能力
 * [OUTPUT]: 对外提供 createDeveloperTools，封装 Codex CLI 定位与磁盘占用分析
 * [POS]: server 模块的开发者工作流服务，被主 HTTP 路由和 Codex 会话服务消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');

function createDeveloperTools({ resolvePath }) {
  async function findCodexBin() {
    // GUI 启动的 app 没有用户 shell 的 PATH，走登录 shell 找一次绝对路径
    return new Promise((resolve) => {
      execFile('/bin/zsh', ['-lc', 'command -v codex'], { timeout: 8000 }, (err, stdout) => {
        const out = String(stdout || '').trim().split('\n').pop();
        resolve(!err && out && out.startsWith('/') ? out : null);
      });
    });
  }

  // ---------- 磁盘占用透视：算清当前目录每个子项的真实占用 ----------
  // 文件直接 stat（快）；目录一次 du -sk 批量算。du 碰到无权限子目录会报错但仍输出能算的部分，所以忽略 err 只用 stdout
  async function diskUsage(p) {
    const dir = resolvePath(p);
    let names;
    try { names = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return { ok: false, error: '读取失败：' + e.message }; }
    const dirs = [], items = [];
    await Promise.all(names.map(async (d) => {
      const full = path.join(dir, d.name);
      if (d.isDirectory() && !d.isSymbolicLink()) { dirs.push(full); return; }
      try { const st = await fsp.lstat(full); if (st.isFile()) items.push({ name: d.name, size: st.size, isDir: false }); } catch { /* */ }
    }));
    if (dirs.length) {
      const out = await new Promise((resolve) => {
        execFile('du', ['-sk', ...dirs], { timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(stdout || ''));
      });
      for (const line of out.split('\n')) {
        const m = line.match(/^(\d+)\s+(.+)$/);
        if (m) items.push({ name: path.basename(m[2]), size: Number(m[1]) * 1024, isDir: true });
      }
    }
    items.sort((a, b) => b.size - a.size);
    const total = items.reduce((a, b) => a + b.size, 0);
    return { ok: true, dir, total, items: items.slice(0, 60), more: Math.max(0, items.length - 60) };
  }

  return { findCodexBin, diskUsage };
}

module.exports = { createDeveloperTools };
