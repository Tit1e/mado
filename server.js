#!/usr/bin/env node
/**
 * [INPUT]: 依赖 Node.js 内置模块、server/ 领域服务、Codex CLI 与 ~/.codex 会话、port-config.js 端口配置和 public 静态资源
 * [OUTPUT]: 对外提供文件 HTTP API、Codex 项目会话归档/删除、静态页面、隔离预览服务与 codexbox CLI 入口
 * [POS]: 根模块的本地服务核心，被直接命令、npm start 和 Electron 主进程复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { resolvePort } = require('./port-config');
const { createConfigStore } = require('./server/config-store');
const { createPathService, IGNORE_DIRS, TEXT_EXT, IMAGE_EXT, VIDEO_EXT, AUDIO_EXT, PDF_EXT, ARCHIVE_EXT, MIME, ext, projectOf, kindOf } = require('./server/path-service');
const { createCodexSessions } = require('./server/codex-sessions');
const { createBrowserService } = require('./server/browser-service');
const { createGitService } = require('./server/git-service');
const { createFileService } = require('./server/file-service');
const { createDeveloperTools } = require('./server/developer-tools');
const { createMediaService } = require('./server/media-service');
const { createRunRuleService } = require('./server/run-rule-service');
const { hostAllowed, originAllowed, readBody, sendJSON } = require('./server/http-security');
const { createAppServer } = require('./server/app-server');
const { createPreviewServer } = require('./server/preview-server');

const HOME = os.homedir();
const PORT = resolvePort({ dev: process.argv.includes('--dev') });
const CONFIG_DIR = path.join(HOME, '.codexbox');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const THUMB_DIR = path.join(CONFIG_DIR, 'thumbs');
const PUBLIC = path.join(__dirname, 'public');
const PLATFORM = process.platform;
const { resolvePath } = createPathService(HOME);
const { readConfig, updateConfig } = createConfigStore(CONFIG_FILE);
const { ruleFor, saveRule, removeRule } = createRunRuleService({ resolvePath, readConfig, updateConfig });
const { listDir, readFile, searchFiles, grepFiles, contentSearch, mdfind } = createBrowserService({
  platform: PLATFORM,
  resolvePath,
  kindOf,
  projectOf,
  ext,
  ignoreDirs: IGNORE_DIRS,
});
const { gitStatus, gitFileDiff } = createGitService({ resolvePath, kindOf });
const { writeTextFile, trashPath, renamePath, movePath, createEntry, termVerify, locatePath, saveImage, openInOS, defaultRoots } = createFileService({
  home: HOME, platform: PLATFORM, resolvePath, textExt: TEXT_EXT, ext, searchFiles, mdfind,
});
const { findCodexBin, organizeLaunch, diskUsage } = createDeveloperTools({
  configDir: CONFIG_DIR, resolvePath,
});
const { archiveList, serveStatic, serveThumb, serveRaw, serveHtmlPreview, pruneThumbs } = createMediaService({
  publicDir: PUBLIC, thumbDir: THUMB_DIR, resolvePath, mime: MIME, ext,
});

// ---------- Codex 项目（最近被 Codex 处理过的项目文件夹）----------
const { codexProjects, inspectCodexProjectSessions, mutateCodexProjectSessions } = createCodexSessions({
  home: HOME,
  platform: PLATFORM,
  resolvePath,
  findCodexBin,
});
const services = {
  listDir, readFile, searchFiles, grepFiles, contentSearch, termVerify, locatePath,
  gitStatus, gitFileDiff, openInOS, updateConfig, writeTextFile, archiveList, diskUsage,
  organizeLaunch, trashPath, movePath, renamePath,
  saveImage, createEntry, inspectCodexProjectSessions, mutateCodexProjectSessions,
  codexProjects, readConfig, ruleFor, saveRule, removeRule, serveRaw, serveHtmlPreview, serveThumb, serveStatic, defaultRoots,
};
const server = createAppServer({
  home: HOME, platform: PLATFORM, port: PORT, resolvePath, ext, pathSeparator: path.sep,
  hostAllowed, originAllowed, readBody, sendJSON, services,
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ⚠️  端口 ${PORT} 已被占用——CodexBox 很可能已经在运行了。`);
    console.error(`      直接打开浏览器访问  http://localhost:${PORT}  就行；`);
    console.error(`      想另开一个，换端口：CODEXBOX_PORT=8080 node server.js\n`);
  } else {
    console.error('\n  启动失败：', err.message, '\n');
  }
  process.exit(1);
});

const PREVIEW_PORT = PORT + 1;
const previewServer = createPreviewServer({
  home: HOME, port: PREVIEW_PORT, resolvePath, ext, hostAllowed, serveRaw, serveHtmlPreview,
});
previewServer.on('error', (err) => { console.error('  ⚠️  预览服务器启动失败：', err.message); });
previewServer.listen(PREVIEW_PORT, '127.0.0.1', () => { console.log(`  🖼  预览源（隔离）：http://localhost:${PREVIEW_PORT}`); });


server.listen(PORT, '127.0.0.1', () => {
  const link = `http://localhost:${PORT}`;
  console.log('\n  📦  CodexBox 已启动');
  console.log(`  🔗  ${link}`);
  console.log('  🏠  根目录:', HOME);
  console.log('\n  按 Ctrl+C 退出\n');
  pruneThumbs().catch(() => {}); // 启动时裁剪缩略图缓存，防止无限增长
  if (!process.env.CODEXBOX_NO_OPEN) {
    const opener = PLATFORM === 'darwin' ? 'open' : PLATFORM === 'win32' ? 'start' : 'xdg-open';
    exec(`${opener} ${link}`, () => {});
  }
});
