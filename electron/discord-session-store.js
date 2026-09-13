/**
 * [INPUT]: 依赖 Node.js 异步文件能力与 ~/.mado 中的 Discord 会话映射文件
 * [OUTPUT]: 对外提供 createDiscordSessionStore，原子保存 Thread、项目与 Pi sessionFile 绑定，并提供进程锁
 * [POS]: electron 的 Discord 持久化边界；不保存任务正文、不解析或改写 Pi JSONL session
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
function createDiscordSessionStore({ file = path.join(os.homedir(), '.mado', 'discord-sessions.json') } = {}) {
  let data = { version: 1, sessions: {} };
  let loaded = false;
  let chain = Promise.resolve();
  async function load() {
    if (loaded) return data;
    try {
      const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
      if (!parsed || parsed.version !== 1 || !parsed.sessions || typeof parsed.sessions !== 'object') throw new Error('会话文件格式无效');
      data = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    loaded = true;
    return data;
  }
  async function save() {
    await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    try { await fsp.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 }); await fsp.rename(tmp, file); }
    catch (error) { await fsp.unlink(tmp).catch(() => {}); throw error; }
  }
  function write(mutator) {
    const run = chain.then(async () => { await load(); await mutator(data); await save(); return data; });
    chain = run.catch(() => {});
    return run;
  }
  function valid(record) {
    return record && typeof record === 'object' && /^\d{17,20}$/.test(record.threadId) && typeof record.projectName === 'string' && record.projectName.length < 200 && typeof record.projectPath === 'string' && path.isAbsolute(record.projectPath) && typeof record.sessionFile === 'string' && (record.sessionFile === '' || path.isAbsolute(record.sessionFile)) && path.basename(record.sessionFile).length < 200;
  }
  async function list() { const current = await load(); return Object.values(current.sessions).filter(valid).map((item) => ({ ...item })); }
  async function get(threadId) { const current = await load(); const item = current.sessions[threadId]; return valid(item) ? { ...item } : null; }
  async function put(record) {
    if (!valid(record)) throw new Error('Discord 会话绑定记录无效');
    return write((current) => {
      const previous = current.sessions[record.threadId];
      if (previous && (previous.projectPath !== record.projectPath || (previous.sessionFile && previous.sessionFile !== record.sessionFile))) throw new Error('子区已有固定绑定，不允许换项目或换 Pi Session');
      current.sessions[record.threadId] = { ...record, updatedAt: Date.now() };

    });
  }
  async function patch(threadId, patch) { const current = await get(threadId); if (!current) throw new Error('Discord 会话绑定不存在'); return put({ ...current, ...patch, threadId }); }
  async function lock(threadId) {
    await load();
    const lockFile = `${file}.${crypto.createHash('sha256').update(threadId).digest('hex').slice(0, 24)}.lock`;
    await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const alive = (pid) => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
    try {
      const previous = JSON.parse(await fsp.readFile(lockFile, 'utf8'));
      if (alive(previous.pid) || alive(previous.childPid)) throw new Error('该 Pi 会话已有进程或残留进程，拒绝重复启动；请先确认并结束旧 Mado/Pi 进程');
      await fsp.unlink(lockFile);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const handle = await fsp.open(lockFile, 'wx', 0o600);
    await handle.close();
    await fsp.writeFile(lockFile, JSON.stringify({ pid: process.pid, time: Date.now() }), { mode: 0o600 });
    return {
      child: async (childPid) => fsp.writeFile(lockFile, JSON.stringify({ pid: process.pid, childPid, time: Date.now() }), { mode: 0o600 }),
      release: async () => fsp.unlink(lockFile).catch(() => {}),
    };
  }
  return { load, list, get, put, patch, lock, file };
}
module.exports = { createDiscordSessionStore };
