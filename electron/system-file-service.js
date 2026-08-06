/**
 * [INPUT]: 依赖 Electron 图片/剪贴板能力、Node.js 文件系统与 ipc-validation.js 安全契约
 * [OUTPUT]: 对外提供 createSystemFileService，处理剪贴板和拖入文件落盘/复制
 * [POS]: electron 模块的系统文件领域服务，由 main.js 装配并被 IPC 处理器调用
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { validDirectory, safeDropName, safeBuffer } = require('./ipc-validation');

function uniqueDest(dest) {
  if (!fs.existsSync(dest)) return dest;
  const dir = path.dirname(dest);
  const ext = path.extname(dest);
  const base = path.basename(dest, ext);
  for (let index = 2; index < 1000; index++) {
    const candidate = path.join(dir, `${base} ${index}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${Date.now()}-${base}${ext}`);
}

function createSystemFileService({ app, nativeImage, clipboard }) {
  function copyImage({ path: imagePath }) {
    try {
      const image = nativeImage.createFromPath(imagePath);
      if (image.isEmpty()) return { ok: false, error: '不是可读图片' };
      clipboard.writeImage(image);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  }
  function copyFile({ path: filePath }) {
    return new Promise((resolve) => {
      execFile('osascript', ['-e', 'on run argv', '-e', 'set the clipboard to (POSIX file (item 1 of argv))', '-e', 'end run', filePath],
        (err) => resolve({ ok: !err, error: err && err.message }));
    });
  }
  function save({ name, buf }) {
    try {
      const dir = path.join(app.getPath('temp'), 'mado-drops');
      fs.mkdirSync(dir, { recursive: true });
      const safe = safeDropName(name, '拖入文件.png');
      const bytes = safeBuffer(buf);
      if (!bytes) return { ok: false, error: '拖入内容无效或过大' };
      let dest = path.join(dir, safe);
      if (fs.existsSync(dest)) dest = path.join(dir, `${Date.now()}-${safe}`);
      fs.writeFileSync(dest, bytes);
      return { ok: true, path: dest };
    } catch (err) { return { ok: false, error: err.message }; }
  }
  function saveInto({ dir, name, buf }) {
    try {
      if (!validDirectory(dir, fs)) return { ok: false, error: '目标目录无效' };
      const bytes = safeBuffer(buf);
      if (!bytes) return { ok: false, error: '拖入内容无效或过大' };
      const dest = uniqueDest(path.join(dir, safeDropName(name, '拖入文件')));
      fs.writeFileSync(dest, bytes);
      return { ok: true, path: dest };
    } catch (err) { return { ok: false, error: err.message }; }
  }
  function copyInto({ srcPath, dir }) {
    try {
      if (!srcPath || !fs.existsSync(srcPath)) return { ok: false, error: '源文件不存在' };
      if (!validDirectory(dir, fs)) return { ok: false, error: '目标目录无效' };
      const dest = uniqueDest(path.join(dir, path.basename(srcPath)));
      if (path.resolve(srcPath) !== path.resolve(dest)) fs.copyFileSync(srcPath, dest);
      return { ok: true, path: dest };
    } catch (err) { return { ok: false, error: err.message }; }
  }
  return { copyImage, copyFile, save, saveInto, copyInto };
}

module.exports = { createSystemFileService, uniqueDest };
