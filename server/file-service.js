/**
 * [INPUT]: 依赖 Node.js 文件/进程能力、路径服务、搜索服务和文本扩展名集合
 * [OUTPUT]: 对外提供 createFileService，封装文件写入/移动/废纸篓、终端路径定位、图片保存与系统打开
 * [POS]: server 模块的可变文件操作领域服务，被主 HTTP 路由与开发工具消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { exec, spawn } = require('child_process');

function shellQuote(value) { return `'${String(value).replace(/'/g, `'\\''`)}'`; }
function validName(name) {
  if (!name || typeof name !== 'string') return false;
  const value = name.trim();
  return value.length > 0 && value.length <= 255 && !/[\/\\\0]/.test(value) && value !== '.' && value !== '..';
}

function createFileService({ home, platform, resolvePath, textExt, ext, searchFiles, mdfind, execCommand = exec }) {
  async function writeTextFile(input, content, expectedMtime) {
    const file = resolvePath(input);
    if (!textExt.has(ext(file))) throw new Error('只支持文本类文件编辑');
    if (typeof content !== 'string') throw new Error('内容非法');
    if (expectedMtime) {
      let current = 0, missing = false;
      try { current = (await fsp.stat(file)).mtimeMs; } catch { missing = true; }
      if (missing || (current && Math.abs(current - expectedMtime) > 1)) {
        const error = new Error(missing ? '文件已被外部删除' : '文件已被外部修改'); error.conflict = true; throw error;
      }
    }
    const tmp = `${file}.mado-tmp-${process.pid}-${Date.now()}`;
    try {
      const fh = await fsp.open(tmp, 'w');
      try { await fh.writeFile(content, 'utf8'); await fh.sync(); } finally { await fh.close(); }
      await fsp.rename(tmp, file);
    } catch (error) { await fsp.unlink(tmp).catch(() => {}); throw error; }
    const stat = await fsp.stat(file);
    return { ok: true, size: stat.size, mtime: stat.mtimeMs };
  }
  function trashPath(input) {
    return new Promise((resolve) => {
      let target;
      try { target = resolvePath(input); } catch { return resolve({ ok: false, error: '非法路径' }); }
      let isDir = false;
      try { isDir = fs.lstatSync(target).isDirectory(); } catch { return resolve({ ok: false, error: '文件不存在' }); }
      let command;
      if (platform === 'darwin') command = `osascript -e 'on run argv' -e 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)' -e 'end run' ${shellQuote(target)}`;
      else if (platform === 'win32') {
        const method = isDir ? 'DeleteDirectory' : 'DeleteFile';
        command = `powershell -NoProfile -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${method}('${target.replace(/'/g, "''")}','OnlyErrorDialogs','SendToRecycleBin')"`;
      } else command = `gio trash ${shellQuote(target)} || trash-put ${shellQuote(target)} || trash ${shellQuote(target)}`;
      execCommand(command, (error) => {
        if (!error) return resolve({ ok: true });
        let message = error.message;
        if (platform === 'darwin' && /-1743|-600|not allowed|authoriz/i.test(message)) message = '需在「系统设置 → 隐私与安全性 → 自动化」里允许 Mado 控制 Finder（首次删除会弹授权）';
        resolve({ ok: false, error: message });
      });
    });
  }
  async function renamePath(input, newName) {
    const src = resolvePath(input); newName = String(newName || '').trim();
    if (!validName(newName)) throw new Error('名称不合法');
    const dest = path.join(path.dirname(src), newName);
    if (fs.existsSync(dest)) throw new Error('已存在同名项');
    await fsp.rename(src, dest);
    return { ok: true, path: dest };
  }
  async function movePath(src, dstDir) {
    const source = resolvePath(src), dir = resolvePath(dstDir);
    if (!fs.existsSync(source)) return { ok: false, error: '源文件不存在' };
    await fsp.mkdir(dir, { recursive: true });
    let dest = path.join(dir, path.basename(source));
    if (fs.existsSync(dest)) {
      const extension = path.extname(dest), base = path.basename(dest, extension); let index = 2;
      while (fs.existsSync(dest)) dest = path.join(dir, `${base}-${index++}${extension}`);
    }
    try { await fsp.rename(source, dest); }
    catch (error) {
      if (error.code === 'EXDEV') { await fsp.copyFile(source, dest); await fsp.unlink(source); }
      else return { ok: false, error: error.message };
    }
    return { ok: true, path: dest };
  }
  async function createEntry(parentPath, name, type) {
    const parent = resolvePath(parentPath); name = String(name || '').trim();
    if (!validName(name)) throw new Error('名称不合法');
    const target = path.join(parent, name);
    if (fs.existsSync(target)) throw new Error('已存在同名项');
    if (type === 'dir') await fsp.mkdir(target); else await fsp.writeFile(target, '', { flag: 'wx' });
    return { ok: true, path: target, isDir: type === 'dir' };
  }
  async function statWithTail(input, tail) {
    const tryStat = async (candidate) => { try { const real = resolvePath(candidate); const stat = await fsp.stat(real); return { found: true, path: real, isDir: stat.isDirectory() }; } catch { return null; } };
    if (!input) return null;
    const direct = await tryStat(input); if (direct) return direct;
    if (!tail) return null;
    const text = String(tail).slice(0, 160).split(/['"`]/)[0], candidates = [];
    const re = /\s+/g; let match;
    while ((match = re.exec(text)) !== null && candidates.length < 6) if (match.index > 0) candidates.push(input + text.slice(0, match.index));
    if (text.trim() && candidates.length < 6) candidates.push(input + text.replace(/\s+$/, ''));
    candidates.sort((a, b) => b.length - a.length);
    for (const candidate of candidates) { const hit = await tryStat(candidate.replace(/[)\]'"`,.:;。，]+$/, '')); if (hit) return hit; }
    return null;
  }
  async function termVerify(body) {
    const cwd = body.cwd ? resolvePath(body.cwd) : home;
    const items = Array.isArray(body.items) ? body.items.slice(0, 24) : [];
    const results = await Promise.all(items.map(async (item) => {
      if (!item || typeof item.cand !== 'string') return false;
      let candidate = item.cand;
      if (!candidate.startsWith('/') && !candidate.startsWith('~')) candidate = cwd.replace(/\/$/, '') + '/' + candidate.replace(/^\.\//, '');
      return !!(await statWithTail(candidate, item.tail || ''));
    }));
    return { ok: true, results };
  }
  async function locatePath(input, name, root, tail, alt, roots) {
    const tryStat = async (candidate) => { try { const real = resolvePath(candidate); const stat = await fsp.stat(real); return { found: true, path: real, isDir: stat.isDirectory() }; } catch { return null; } };
    const direct = await statWithTail(input, tail); if (direct) return direct;
    for (const candidate of String(alt || '').split('\n').filter(Boolean).slice(0, 3)) { const hit = await tryStat(candidate); if (hit) return { ...hit, viaScrollback: true }; }
    if (!name) return { found: false };
    const budget = Date.now() + 6000, seen = []; let fuzzy = null;
    for (const candidateRoot of [root, ...(roots || [])].filter(Boolean)) {
      let resolved; try { resolved = resolvePath(candidateRoot); } catch { continue; }
      if (seen.some((dir) => resolved === dir || resolved.startsWith(dir + path.sep))) continue;
      seen.push(resolved);
      try {
        const data = await searchFiles(name, resolved, budget);
        const exact = data.results.filter((item) => item.name === name).sort((a, b) => b.mtime - a.mtime)[0];
        if (exact) return { found: true, path: exact.path, isDir: exact.isDir, viaSearch: true };
        if (!fuzzy) fuzzy = data.results[0];
      } catch { /* 单根搜索失败继续 */ }
    }
    if (fuzzy) return { found: true, path: fuzzy.path, isDir: fuzzy.isDir, viaSearch: true };
    if (platform === 'darwin') {
      const paths = await mdfind(['-name', name]); let best = null;
      for (const file of (paths || []).slice(0, 200)) {
        if (path.basename(file) !== name) continue;
        try { const stat = await fsp.stat(file); if (!best || stat.mtimeMs > best.m) best = { path: file, isDir: stat.isDirectory(), m: stat.mtimeMs }; } catch { /* */ }
      }
      if (best) return { found: true, path: best.path, isDir: best.isDir, viaSearch: true };
    }
    return { found: false };
  }
  async function saveImage({ path: target, dataUrl, newName }) {
    const match = /^data:image\/\w+;base64,(.+)$/s.exec(dataUrl || '');
    if (!match) throw new Error('无效图片数据');
    let dest = resolvePath(target);
    if (newName) { if (!validName(newName)) throw new Error('文件名不合法'); dest = path.join(path.dirname(dest), newName); if (fs.existsSync(dest)) throw new Error('已存在同名文件'); }
    const tmp = `${dest}.mado-tmp-${process.pid}-${Date.now()}`;
    try { const fh = await fsp.open(tmp, 'w'); try { await fh.writeFile(Buffer.from(match[1], 'base64')); await fh.sync(); } finally { await fh.close(); } await fsp.rename(tmp, dest); }
    catch (error) { await fsp.unlink(tmp).catch(() => {}); throw error; }
    return { ok: true, path: dest, size: (await fsp.stat(dest)).size };
  }
  function openDefault(target, withApp) {
    return new Promise((resolve) => {
      let command;
      if (platform === 'darwin') command = withApp === 'reveal' ? `open -R ${shellQuote(target)}` : `open ${shellQuote(target)}`;
      else if (platform === 'win32') command = withApp === 'reveal' ? `explorer /select,"${target}"` : `start "" "${target}"`;
      else command = withApp === 'reveal' ? `xdg-open ${shellQuote(path.dirname(target))}` : `xdg-open ${shellQuote(target)}`;
      execCommand(command, (error) => resolve(error ? { ok: false, error: error.message } : { ok: true, with: withApp || 'default' }));
    });
  }
  function openInOS(target, withApp) {
    if (withApp !== 'terminal' && withApp !== 'editor') return openDefault(target, withApp);
    if (withApp === 'terminal') {
      const dir = (() => { try { return fs.statSync(target).isDirectory() ? target : path.dirname(target); } catch { return path.dirname(target); } })();
      const command = platform === 'darwin' ? `open -a Terminal ${shellQuote(dir)}` : platform === 'win32' ? `start "" cmd /K cd /d "${dir}"` : `x-terminal-emulator --working-directory=${shellQuote(dir)} || gnome-terminal --working-directory=${shellQuote(dir)} || xterm`;
      return new Promise((resolve) => execCommand(command, (error) => resolve(error ? { ok: false, error: error.message } : { ok: true, with: 'terminal' })));
    }
    return new Promise((resolve) => {
      const child = spawn('code', [target], { stdio: 'ignore', detached: true });
      child.on('error', () => openDefault(target, withApp).then(resolve));
      child.on('spawn', () => { child.unref(); resolve({ ok: true, with: 'editor' }); });
    });
  }
  function defaultRoots() {
    return [['主目录', home], ['桌面', path.join(home, 'Desktop')], ['文档', path.join(home, 'Documents')], ['下载', path.join(home, 'Downloads')], ['代码 / Code', path.join(home, 'Code')], ['项目 / Projects', path.join(home, 'Projects')], ['Developer', path.join(home, 'Developer')]]
      .filter(([, target]) => { try { return fs.statSync(target).isDirectory(); } catch { return false; } })
      .map(([name, target]) => ({ name, path: target }));
  }
  return { writeTextFile, trashPath, renamePath, movePath, createEntry, termVerify, locatePath, saveImage, openInOS, defaultRoots, shellQuote };
}

module.exports = { createFileService, shellQuote, validName };
