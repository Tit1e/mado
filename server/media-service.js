/**
 * [INPUT]: 依赖 Node.js 文件/进程/流能力、public 静态资源、缩略图缓存和调用方路径规则
 * [OUTPUT]: 对外提供 createMediaService，封装压缩包、静态资源、缩略图、HEIC、原始文件与 HTML 预览
 * [POS]: server 模块的媒体与静态响应服务，被主服务和隔离预览服务共同消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

function createMediaService({ publicDir, thumbDir, resolvePath, mime, ext }) {
  const PUBLIC = publicDir;
  const THUMB_DIR = thumbDir;
  const MIME = mime;
// 压缩包内容清单：全用系统自带工具（unzip / bsdtar / gzip），保持零依赖
// 直接读 zip 中央目录拿文件名：按「通用位标记 bit 11 = UTF-8」决定编码，没设就按 GBK 解（中文名才不乱码）。
// 系统 unzip/bsdtar 会先把字节转码、丢失原始编码，没法事后挽救，所以自己解。zip64/异常结构返回 null 交回退。
async function zipNames(file, MAX) {
  let fd;
  try {
    fd = await fsp.open(file, 'r');
    const { size } = await fd.stat();
    const tailLen = Math.min(size, 65557); // EOCD 22 字节 + 最多 65535 注释
    const tail = Buffer.alloc(tailLen);
    await fd.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) { if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) return null;
    const cdCount = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdOffset === 0xffffffff || cdSize === 0xffffffff) return null; // zip64，超出本简单解析
    const cd = Buffer.alloc(cdSize);
    await fd.read(cd, 0, cdSize, cdOffset);
    const gbk = new TextDecoder('gbk');
    const out = [];
    let p = 0;
    for (let i = 0; i < cdCount && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break; // central file header 签名
      const flag = cd.readUInt16LE(p + 8);
      const usize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const nameBuf = cd.subarray(p + 46, p + 46 + nameLen);
      let nm;
      if (flag & 0x800) nm = nameBuf.toString('utf8');
      else { try { nm = gbk.decode(nameBuf); } catch { nm = nameBuf.toString('utf8'); } }
      out.push({ name: nm, size: usize });
      p += 46 + nameLen + extraLen + commentLen;
      if (out.length > MAX) break;
    }
    return out;
  } catch { return null; } // 解析失败一律交给 unzip 兜底
  finally { if (fd) await fd.close().catch(() => {}); }
}

async function archiveList(p) {
  const file = resolvePath(p);
  try { await fsp.stat(file); } catch { return { ok: false, error: '文件不存在' }; }
  const name = path.basename(file).toLowerCase();
  // 压缩包里的中文名常是 GBK/CP936 且没设 UTF-8 标志位，按 UTF-8 读会乱码：
  // 拿原始字节，先严格按 UTF-8 解，失败（多半是 GBK 中文名）再回退 GBK。
  const decodeMaybeGbk = (buf) => {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { try { return new TextDecoder('gbk').decode(buf); } catch { return buf.toString('latin1'); } }
  };
  const run = (cmd, args) => new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15000, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer' }, (err, stdout) => (err ? reject(err) : resolve(decodeMaybeGbk(stdout))));
  });
  const MAX = 800;
  const entries = [];
  try {
    if (/\.(zip|jar)$/.test(name)) {
      const parsed = await zipNames(file, MAX); // 自读中央目录，中文名按 GBK/UTF-8 正确解（unzip 会乱码）
      if (parsed) {
        entries.push(...parsed);
      } else { // zip64 / 异常结构本解析器够不着：回退 unzip（名字可能乱码，但至少列得出）
        const out = await run('unzip', ['-l', '--', file]);
        for (const line of out.split('\n')) {
          const m = line.match(/^\s*(\d+)\s+\S+\s+\S+\s+(.+)$/);
          if (m) entries.push({ name: m[2], size: Number(m[1]) });
          if (entries.length > MAX) break;
        }
      }
    } else if (/\.(tar|tgz|tbz2?|txz)$/.test(name) || /\.tar\.(gz|bz2|xz|zst)$/.test(name)) {
      const out = await run('tar', ['-tf', file]); // bsdtar 自动识别压缩格式
      for (const line of out.split('\n')) {
        if (line.trim()) entries.push({ name: line });
        if (entries.length > MAX) break;
      }
    } else if (/\.gz$/.test(name)) {
      const out = await run('gzip', ['-l', file]);
      const m = out.split('\n')[1] && out.split('\n')[1].match(/^\s*\d+\s+(\d+)/);
      entries.push({ name: path.basename(file, '.gz'), size: m ? Number(m[1]) : undefined });
    } else {
      return { ok: false, error: '7z / rar 没有系统自带的解析工具，可在系统解压软件中打开' };
    }
  } catch (e) {
    return { ok: false, error: '读取失败：' + (e.message || '').split('\n')[0] };
  }
  const truncated = entries.length > MAX;
  return { ok: true, entries: entries.slice(0, MAX), truncated };
}

// ---------- 静态资源 ----------

async function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = decodeURIComponent(rel.split('?')[0]);
  const filePath = path.normalize(path.join(PUBLIC, rel));
  // 边界要带分隔符，否则 /path/to/public-evil 也会 startsWith('/path/to/public') 通过
  if (filePath !== PUBLIC && !filePath.startsWith(PUBLIC + path.sep)) { res.writeHead(403); res.end('forbidden'); return; }
  try {
    const data = await fsp.readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}

// ---------- 缩略图（性能关键：不再把原图/原视频整文件当缩略图）----------
const THUMB_IMG_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'heic', 'heif', 'avif']);
const ALPHA_IMG_EXT = new Set(['png', 'gif', 'webp', 'avif']); // 可能带透明通道：缩略图必须出 png，jpeg 会把透明拍成白底
const thumbInflight = new Map(); // cacheFile -> Promise，去重并发生成
function run(cmd, args) {
  return new Promise((resolve, reject) => execFile(cmd, args, { timeout: 15000 }, (e) => (e ? reject(e) : resolve())));
}
// 图片走 sips 缩放（快）；视频/PDF/其它走 qlmanage QuickLook 抽帧
async function generateThumb(src, e, size, cacheFile, isImg) {
  await fsp.mkdir(THUMB_DIR, { recursive: true });
  if (isImg) {
    const fmt = cacheFile.endsWith('.png') ? 'png' : 'jpeg';
    await run('sips', ['-s', 'format', fmt, '-Z', String(size), src, '--out', cacheFile]);
    return;
  }
  const tmpDir = path.join(THUMB_DIR, '_ql_' + process.pid + '_' + crypto.randomBytes(4).toString('hex'));
  await fsp.mkdir(tmpDir, { recursive: true });
  try {
    await run('qlmanage', ['-t', '-s', String(size), '-o', tmpDir, src]);
    const png = (await fsp.readdir(tmpDir)).find((f) => f.endsWith('.png'));
    if (!png) throw new Error('no thumb');
    await fsp.rename(path.join(tmpDir, png), cacheFile);
  } finally { fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}); }
}
// 缩略图缓存按总体积上限做 LRU 裁剪（同一文件改一次就多一个缓存键，不清会无限涨）
async function pruneThumbs(maxBytes = 400 * 1024 * 1024) {
  try {
    const files = await fsp.readdir(THUMB_DIR);
    const stats = (await Promise.all(files.map(async (f) => {
      if (f.startsWith('_ql_')) return null;
      const fp = path.join(THUMB_DIR, f);
      try { const s = await fsp.stat(fp); return s.isFile() ? { fp, size: s.size, t: s.mtimeMs } : null; } catch { return null; }
    }))).filter(Boolean);
    let total = stats.reduce((a, b) => a + b.size, 0);
    if (total <= maxBytes) return;
    stats.sort((a, b) => a.t - b.t); // 最旧的先删
    for (const f of stats) { if (total <= maxBytes) break; await fsp.unlink(f.fp).catch(() => {}); total -= f.size; }
  } catch { /* 目录不存在等，忽略 */ }
}

async function serveThumb(req, res, p, size) {
  let src;
  try { src = resolvePath(p); } catch { res.writeHead(400); res.end('bad path'); return; }
  let st;
  try { st = await fsp.stat(src); if (!st.isFile()) throw 0; } catch { res.writeHead(404); res.end('not found'); return; }
  const s = Math.min(1600, Math.max(48, size || 240));
  const e = ext(src);
  const isImg = THUMB_IMG_EXT.has(e);
  const key = crypto.createHash('md5').update(src + ':' + st.mtimeMs + ':' + s).digest('hex');
  const jpegOut = isImg && !ALPHA_IMG_EXT.has(e);
  const cacheFile = path.join(THUMB_DIR, key + (jpegOut ? '.jpg' : '.png'));
  const type = jpegOut ? 'image/jpeg' : 'image/png';
  const sendCache = () => {
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'max-age=604800' });
    const rs = fs.createReadStream(cacheFile);
    rs.on('error', () => { try { res.destroy(); } catch { /* */ } }); // 读缓存中途出错别让未捕获 error 打挂进程
    rs.pipe(res);
  };
  if (fs.existsSync(cacheFile)) return sendCache();
  let pr = thumbInflight.get(cacheFile);
  if (!pr) { pr = generateThumb(src, e, s, cacheFile, isImg).finally(() => thumbInflight.delete(cacheFile)); thumbInflight.set(cacheFile, pr); }
  try { await pr; sendCache(); }
  catch { res.writeHead(415); res.end('no thumb'); } // 前端 onerror 回退矢量图标
}

// HEIC/HEIF 浏览器与 Chromium 原生不支持：用 sips 全尺寸转码成 jpeg 缓存后再吐，
// /api/raw 和 /fs/ 都透明走这条，markdown 里的 ![](x.heic) 预览即可显示。复用缩略图那套 run/缓存/LRU。
const HEIC_EXT = new Set(['heic', 'heif']);
async function serveHeicAsJpeg(req, res, file, st) {
  const key = crypto.createHash('md5').update(file + ':' + st.mtimeMs).digest('hex');
  const cacheFile = path.join(THUMB_DIR, key + '.heic.jpg');
  const send = () => {
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=604800' });
    const rs = fs.createReadStream(cacheFile);
    rs.on('error', () => { try { res.destroy(); } catch { /* */ } });
    rs.pipe(res);
  };
  if (fs.existsSync(cacheFile)) return send();
  let pr = thumbInflight.get(cacheFile);
  if (!pr) {
    pr = (async () => { await fsp.mkdir(THUMB_DIR, { recursive: true }); await run('sips', ['-s', 'format', 'jpeg', file, '--out', cacheFile]); })()
      .finally(() => thumbInflight.delete(cacheFile));
    thumbInflight.set(cacheFile, pr);
  }
  try { await pr; pruneThumbs(); send(); }
  catch { res.writeHead(415); res.end('heic transcode failed'); } // 前端 onerror 回退矢量图标
}

// 流式返回原始文件（图片 / 视频 / pdf / 音频预览），支持 Range
function serveRaw(req, res, filePath) {
  let file;
  try { file = resolvePath(filePath); } catch { res.writeHead(400); res.end('bad path'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    if (HEIC_EXT.has(ext(file))) return serveHeicAsJpeg(req, res, file, st); // HEIC → 转码 jpeg，绕过下面的原始字节路径
    const type = MIME[ext(file)] || 'application/octet-stream';
    const onStreamErr = (rs) => rs.on('error', () => { try { res.destroy(); } catch { /* */ } });
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      // 钳制到文件实际范围：畸形 Range（如 bytes=99999999-）否则会让 createReadStream 抛未捕获 error 崩进程
      let startB = m && m[1] ? parseInt(m[1], 10) : 0;
      let endB = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (!Number.isFinite(startB) || startB < 0) startB = 0;
      if (!Number.isFinite(endB) || endB > st.size - 1) endB = st.size - 1;
      if (startB > endB) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${startB}-${endB}/${st.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': endB - startB + 1,
      });
      const rs = fs.createReadStream(file, { start: startB, end: endB });
      onStreamErr(rs); rs.pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
      const rs = fs.createReadStream(file);
      onStreamErr(rs); rs.pipe(res);
    }
  });
}

// 为 /fs/ 下 HTML 预览注入辅助标签：
// 1. 测宽脚本——桌面 Chromium 的 iframe 会忽略 viewport meta，定宽桌面页照样按自身宽度铺开，
//    窄预览框只能露出左上角；脚本把页面自然宽度 postMessage 给前端，由前端整页等比缩放适配。
// 2. 兜底样式——html/body 可滚动、图片视频不超宽（canvas/svg 不动，挤压它们会让动效 demo 变形）。
// 3. viewport meta——桌面 iframe 用不上，但保留它，手机经局域网访问预览时有用。
async function serveHtmlPreview(req, res, filePath) {
  let file;
  try { file = resolvePath(filePath); } catch { res.writeHead(400); res.end('bad path'); return; }
  try {
    const st = await fsp.stat(file);
    if (!st.isFile()) { res.writeHead(404); res.end('not found'); return; }
  } catch { res.writeHead(404); res.end('not found'); return; }
  try {
    let html = await fsp.readFile(file, 'utf8');
    const viewportRe = /<meta[^>]*name=["']viewport["'][^>]*>/i;
    const styleBlock = `<style data-mado-preview>
  html, body { overflow: auto; }
  img, video { max-width: 100%; height: auto; }
</style>`;
    const measureScript = '<script data-mado-measure>(function(){var l=0;function r(){var w=Math.max(document.documentElement.scrollWidth,document.body?document.body.scrollWidth:0);if(w&&w!==l){l=w;try{parent.postMessage({madoPreviewWidth:w},"*")}catch(e){}}}addEventListener("load",function(){r();setTimeout(r,300)});addEventListener("resize",r)})()</script>';
    // 本地图片引用兜底：不同 agent 写 html 引图方式各异，http 预览（沙箱 iframe）里有两类必裂——
    //   ① file:// 绝对 URL（http 页面禁加载 file://）；② /Users 这种裸绝对路径（解析到源站根）。
    // 策略分两层，确保「修问题不引入新问题」：
    //   · 主动改写：只碰 file://（http 预览里永远加载不了，改成 /fs 镜像只会帮忙、不会误伤任何能用的引用）；
    //   · 失败兜底：其余绝对路径只在「已加载失败」时才重写到 /fs 再试一次（对本来能加载的引用零影响 → 结构性零回归）。
    //   · 相对路径走 /fs/<目录>/ 本就正常，失败多半是文件真没了，不强行兜底。
    // 未覆盖（注释在此说清，别让后人误以为全兜住）：<style> 块/外部 css 里的 file:// 背景图、srcset、加载后 JS 动态插入的元素。
    const localImgScript = '<script data-mado-localimg>(function(){var FS="/fs";function f2fs(u){return (u&&u.slice(0,7)==="file://")?FS+u.slice(7):null;}function fix(el){if(!el.getAttribute)return;["src","href","poster"].forEach(function(a){var v=el.getAttribute(a),n=f2fs(v);if(n)el.setAttribute(a,n);});var st=el.getAttribute("style");if(st&&st.indexOf("file://")>-1)el.setAttribute("style",st.split("file://").join(FS));}function sweep(){document.querySelectorAll("[src],[href],[poster],[style]").forEach(fix);}sweep();document.addEventListener("DOMContentLoaded",sweep);document.addEventListener("error",function(e){var el=e.target;if(!el||!el.getAttribute||el.getAttribute("data-fs-tried"))return;var attr=el.tagName==="LINK"?"href":"src",v=el.getAttribute(attr);if(!v||v.charAt(0)!=="/"||v.slice(0,4)==="/fs/")return;if(/^(https?:|data:|blob:)/.test(v))return;el.setAttribute("data-fs-tried","1");el.setAttribute(attr,FS+v);},true);})()</script>';
    function injectHead(tag) {
      const headClose = html.match(/<\/head>/i);
      const headOpen = html.match(/<head[^>]*>/i);
      if (headClose) {
        html = html.slice(0, headClose.index) + '  ' + tag + '\n' + html.slice(headClose.index);
      } else if (headOpen) {
        html = html.slice(0, headOpen.index + headOpen[0].length) + '\n  ' + tag + '\n' + html.slice(headOpen.index + headOpen[0].length);
      } else {
        // 没有 <head> 时，把标签插到 <!DOCTYPE ...> 之后，或文档最开头
        const doctype = html.match(/<!DOCTYPE[^>]*>/i);
        if (doctype) {
          html = html.slice(0, doctype.index + doctype[0].length) + '\n' + tag + html.slice(doctype.index + doctype[0].length);
        } else {
          html = tag + '\n' + html;
        }
      }
    }
    if (!viewportRe.test(html)) {
      injectHead('<meta name="viewport" content="width=device-width, initial-scale=1">');
    }
    if (!html.includes('data-mado-preview')) {
      injectHead(styleBlock);
    }
    if (!html.includes('data-mado-measure')) {
      injectHead(measureScript);
    }
    if (!html.includes('data-mado-localimg')) {
      injectHead(localImgScript);
    }
    const buf = Buffer.from(html, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': buf.length });
    res.end(buf);
  } catch (err) {
    // 读取/编码异常时回退到原始流，保证至少能打开
    console.error('serveHtmlPreview fallback', err);
    return serveRaw(req, res, filePath);
  }
}

const MAX_BODY = 64 * 1024 * 1024; // 64MB 上限，防止恶意请求无限累加把内存撑爆
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    let size = 0;
    let aborted = false;
    req.on('data', (c) => {
      if (aborted) return;
      size += c.length;
      if (size > MAX_BODY) { aborted = true; try { req.destroy(); } catch { /* */ } resolve({}); return; }
      data += c;
    });
    req.on('end', () => { if (!aborted) { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } } });
    req.on('error', () => { if (!aborted) { aborted = true; resolve({}); } });
  });
}

  return { archiveList, serveStatic, serveThumb, serveRaw, serveHtmlPreview, pruneThumbs };
}

module.exports = { createMediaService };
