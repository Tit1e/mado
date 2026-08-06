/**
 * [INPUT]: 依赖 Node.js HTTP、HTTP 安全基础设施和全部服务端领域服务
 * [OUTPUT]: 对外提供 createAppServer，创建 CodexBox 主 API 与静态资源服务
 * [POS]: server 模块的 HTTP 路由组合器，由根 server.js 创建并监听
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const http = require('http');
const path = require('path');
const { URL } = require('url');

function createAppServer(options) {
  const { home: HOME, platform: PLATFORM, port: PORT, resolvePath, ext, hostAllowed, originAllowed, readBody, sendJSON } = options;
  const {
    defaultRoots, listDir, readFile, serveRaw, serveHtmlPreview, serveThumb, searchFiles, grepFiles, contentSearch,
    termVerify, locatePath, gitStatus, gitFileDiff, openInOS, updateConfig, writeTextFile, archiveList, diskUsage,
    organizeLaunch, trashPath, movePath, renamePath, saveImage, createEntry,
    inspectCodexProjectSessions, mutateCodexProjectSessions, codexProjects, readConfig, ruleFor, saveRule, removeRule, serveStatic,
  } = options.services;
const server = http.createServer(async (req, res) => {
  if (!hostAllowed(req)) { res.writeHead(403); res.end('forbidden host'); return; }
  if (req.method === 'POST' && !originAllowed(req)) { res.writeHead(403); res.end('forbidden origin'); return; }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  const qp = url.searchParams;

  try {
    if (p === '/api/roots') {
      return sendJSON(res, 200, { home: HOME, platform: PLATFORM, sep: path.sep, roots: defaultRoots() });
    }
    if (p === '/api/list') {
      return sendJSON(res, 200, await listDir(qp.get('path') || HOME));
    }
    if (p === '/api/read') {
      return sendJSON(res, 200, await readFile(qp.get('path')));
    }
    if (p === '/api/raw') {
      return serveRaw(req, res, qp.get('path'));
    }
    // 路径镜像端点：/fs/<绝对路径> 按真实磁盘路径出文件。
    // HTML 预览的 iframe 指到这里后，页面里的相对引用（./img.png、子目录、嵌套 iframe）
    // 都能按所在目录正确解析——srcdoc 方案没有 base URL，这些全是裂的。
    // 暴露面与 /api/raw 等价（都接受任意绝对路径），且同样只对本机回环开放。
    // HTML 文件额外注入 viewport，让预览框内宽度自适应、滚动稳定。
    if (p.startsWith('/fs/')) {
      const fsPath = decodeURIComponent(p.slice(3));
      const fsExt = (ext(fsPath) || '').toLowerCase();
      if (fsExt === 'html' || fsExt === 'htm') {
        return serveHtmlPreview(req, res, fsPath);
      }
      return serveRaw(req, res, fsPath);
    }
    if (p === '/api/thumb') {
      return serveThumb(req, res, qp.get('path'), parseInt(qp.get('w') || '240', 10));
    }
    if (p === '/api/search') {
      return sendJSON(res, 200, await searchFiles(qp.get('q'), qp.get('root') || HOME));
    }
    if (p === '/api/grep') {
      return sendJSON(res, 200, await grepFiles(qp.get('q'), qp.get('root') || HOME));
    }
    if (p === '/api/content') {
      return sendJSON(res, 200, await contentSearch(qp.get('q'), qp.get('root') || HOME));
    }
    if (p === '/api/term-verify' && req.method === 'POST') {
      return sendJSON(res, 200, await termVerify(await readBody(req)));
    }
    if (p === '/api/locate') {
      const extraRoots = String(qp.get('roots') || '').split('\n').filter(Boolean).slice(0, 3);
      return sendJSON(res, 200, await locatePath(qp.get('path'), qp.get('name'), qp.get('root'), qp.get('tail'), qp.get('alt'), extraRoots));
    }
    if (p === '/api/git') {
      return sendJSON(res, 200, await gitStatus(qp.get('path') || HOME));
    }
    if (p === '/api/git-file') {
      return sendJSON(res, 200, await gitFileDiff(qp.get('path')));
    }
    if (p === '/api/open' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await openInOS(resolvePath(body.path), body.with);
      // 记录最近打开（串行 RMW，不丢更新）
      if (result.ok) {
        await updateConfig((cfg) => { cfg.recentOpened = [body.path, ...(cfg.recentOpened || []).filter((x) => x !== body.path)].slice(0, 30); });
      }
      return sendJSON(res, 200, result);
    }
    if (p === '/api/recent-open' && req.method === 'POST') {
      // 内部预览/编辑也记入「最近打开」，去重 + 最近优先（串行 RMW）
      const body = await readBody(req);
      if (body.path) {
        const cfg = await updateConfig((c) => { c.recentOpened = [body.path, ...(c.recentOpened || []).filter((x) => x !== body.path)].slice(0, 30); });
        return sendJSON(res, 200, { ok: true, recentOpened: cfg.recentOpened });
      }
      return sendJSON(res, 200, { ok: false });
    }
    if (p === '/api/write' && req.method === 'POST') {
      const b = await readBody(req);
      try { return sendJSON(res, 200, await writeTextFile(b.path, b.content, b.expectedMtime)); }
      catch (e) { return sendJSON(res, 200, { ok: false, conflict: !!e.conflict, error: e.message }); }
    }
    if (p === '/api/archive') {
      return sendJSON(res, 200, await archiveList(url.searchParams.get('path')));
    }
    if (p === '/api/du') {
      return sendJSON(res, 200, await diskUsage(url.searchParams.get('path')));
    }
    if (p === '/api/lang' && req.method === 'POST') {
      const b = await readBody(req);
      const lang = b.lang === 'en' ? 'en' : 'zh';
      await updateConfig((c) => { c.lang = lang; });
      return sendJSON(res, 200, { ok: true, lang });
    }
    if (p === '/api/run-rule') {
      if (req.method === 'POST') return sendJSON(res, 200, await saveRule(await readBody(req)));
      return sendJSON(res, 200, await ruleFor(qp.get('path') || HOME));
    }
    if (p === '/api/run-rule/delete' && req.method === 'POST') {
      return sendJSON(res, 200, await removeRule(await readBody(req)));
    }
    if (p === '/api/organize/launch' && req.method === 'POST') {
      return sendJSON(res, 200, await organizeLaunch(await readBody(req)));
    }
    if (p === '/api/trash' && req.method === 'POST') {
      const b = await readBody(req);
      return sendJSON(res, 200, await trashPath(b.path));
    }
    if (p === '/api/move' && req.method === 'POST') {
      const b = await readBody(req);
      return sendJSON(res, 200, await movePath(b.src, b.dstDir));
    }
    if (p === '/api/rename' && req.method === 'POST') {
      const b = await readBody(req);
      return sendJSON(res, 200, await renamePath(b.path, b.newName));
    }
    if (p === '/api/image-save' && req.method === 'POST') {
      const body = await readBody(req);
      try { return sendJSON(res, 200, await saveImage(body)); }
      catch (e) { return sendJSON(res, 200, { error: e.message }); }
    }
    if (p === '/api/create' && req.method === 'POST') {
      const b = await readBody(req);
      return sendJSON(res, 200, await createEntry(b.path, b.name, b.type));
    }
    if (p === '/api/codex-projects/inspect' && req.method === 'POST') {
      const body = await readBody(req);
      return sendJSON(res, 200, await inspectCodexProjectSessions(body.path, body.action));
    }
    if ((p === '/api/codex-projects/archive' || p === '/api/codex-projects/delete') && req.method === 'POST') {
      const body = await readBody(req);
      const action = p.endsWith('/delete') ? 'delete' : 'archive';
      return sendJSON(res, 200, await mutateCodexProjectSessions(body.path, action, body.snapshot));
    }
    if (p === '/api/codex-projects') {
      return sendJSON(res, 200, await codexProjects());
    }
    if (p === '/api/favorites') {
      if (req.method === 'POST') {
        const body = await readBody(req);
        const cfg = await updateConfig((c) => {
          const has = (c.favorites || []).some((f) => f.path === body.path);
          c.favorites = has
            ? c.favorites.filter((f) => f.path !== body.path)
            : [{ path: body.path, name: body.name, isDir: body.isDir }, ...(c.favorites || [])].slice(0, 50);
        });
        return sendJSON(res, 200, { favorites: cfg.favorites || [], recentOpened: cfg.recentOpened || [] });
      }
      const cfg = await readConfig();
      return sendJSON(res, 200, { favorites: cfg.favorites || [], recentOpened: cfg.recentOpened || [] });
    }

    // 静态资源
    return await serveStatic(req, res, p);
  } catch (err) {
    return sendJSON(res, 500, { error: err.message });
  }
});

  return server;
}

module.exports = { createAppServer };
