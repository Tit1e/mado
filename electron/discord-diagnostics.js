/**
 * [INPUT]: 依赖 Node.js 文件/随机数/系统能力，调用方提供日志目录、版本信息与需要脱敏的密钥
 * [OUTPUT]: 对外提供 createDiscordDiagnostics，提供关联错误 ID、轮转 JSONL、脱敏文本与可复制诊断报告
 * [POS]: electron 的 Discord 本地诊断真源，不记录任务正文、思考、工具参数或完整 RPC 数据
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const { stripVTControlCharacters } = require('util');
const MAX_LOG_BYTES = 2 * 1024 * 1024;

function createDiscordDiagnostics({ directory, versions = {}, secrets = [] }) {
  const runId = randomUUID();
  const recent = [];
  const knownSecrets = new Set(secrets.filter((item) => typeof item === 'string' && item.length > 3));
  for (const [key, value] of Object.entries(process.env)) {
    if (/(token|secret|password|api_?key)/i.test(key) && value?.length > 3) knownSecrets.add(value);
  }
  let lastError = null;
  let storageError = '';
  function redact(value) {
    let text = stripVTControlCharacters(String(value ?? ''));
    for (const secret of knownSecrets) text = text.split(secret).join('[REDACTED]');
    return text
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[PRIVATE KEY REDACTED]')
      .replace(/\b(?:Bot|Bearer)\s+[\w.+\/-]+/gi, '[AUTH REDACTED]')
      .replace(/\b(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{8,}/g, '[KEY REDACTED]')
      .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/g, '[TOKEN REDACTED]')
      .replace(/((?:token|password|secret|api[_-]?key)["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, '$1[REDACTED]')
      .replace(/https?:\/\/[^\s"'<>]+/g, (url) => url.split('?')[0].replace(/\/webhooks\/.*/, '/webhooks/[REDACTED]').replace(/\/\/[^/@]+@/, '//[REDACTED]@'))
      .split(os.homedir()).join('~')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  }
  function record(level, code, fields = {}) {
    const entry = { time: new Date().toISOString(), runId, level, code, ...fields };
    const sanitize = (value, depth = 0) => {
      if (depth > 3) return '[TRUNCATED]';
      if (typeof value === 'string') return redact(value).slice(0, 8000);
      if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [key, sanitize(item, depth + 1)]));
      return value;
    };
    const safe = sanitize(entry);
    recent.push(safe);
    if (recent.length > 200) recent.shift();
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const file = path.join(directory, 'events.jsonl');
      if (fs.existsSync(file) && fs.statSync(file).size >= MAX_LOG_BYTES) {
        fs.rmSync(`${file}.2`, { force: true });
        if (fs.existsSync(`${file}.1`)) fs.renameSync(`${file}.1`, `${file}.2`);
        fs.renameSync(file, `${file}.1`);
      }
      fs.appendFileSync(file, JSON.stringify(safe) + '\n', { mode: 0o600 });
    } catch (error) { storageError = redact(error.message).slice(0, 500); }
    return safe;
  }
  function error(code, cause, fields = {}) {
    const errorId = randomUUID().slice(0, 8);
    lastError = record('error', code, {
      ...fields, errorId, name: cause?.name, message: redact(cause?.message || cause).slice(0, 3000),
      systemCode: cause?.code, httpStatus: cause?.status,
      stack: redact(cause?.stack || '').slice(0, 6000),
    });
    return errorId;
  }
  function report(state = {}) {
    return JSON.stringify({ runId, versions, platform: process.platform, arch: process.arch,
      osRelease: os.release(), state, lastError, storageError, recent }, null, 2);
  }
  record('info', 'BRIDGE_BOOT', { versions });
  return { record, error, redact, report, directory, runId, addSecret: (value) => knownSecrets.add(value), lastError: () => lastError };
}
module.exports = { createDiscordDiagnostics };
