/**
 * [INPUT]: 依赖 Node.js child_process、文件/路径能力与 Pi 官方 JSONL RPC（0.85.1 接口）
 * [OUTPUT]: 对外提供 createPiRpcSession，提供新进程启动、单轮对话、过程增量事件、最终文本事件和受控停止
 * [POS]: electron 的 Discord 专用 Pi CLI 适配器，与桌面 PTY 独立；不链接 SDK、不读取 Pi 私有文件
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const MAX_FRAME = 16 * 1024 * 1024;
const MAX_SUMMARY = 60000;
const READY_TIMEOUT = 30000;
const TURN_TIMEOUT = 30 * 60 * 1000;
const SUMMARY_INSTRUCTION = '你正在通过 Discord 接收远程开发任务。每轮结束时，用中文给出简洁的最终执行总结，说明结果、修改文件、实际运行的测试和未完成事项。未运行的测试必须明确写未运行，不要编造成功。不要在回复中泄露凭据或环境变量。';

function createPiRpcSession({ cwd, piPath, sessionId, sessionFile = '', sessionDir = '', expectedSessionId = '', diagnostics, onEvent = () => {}, spawnProcess = spawn }) {
  let child = null;
  let closing = false;
  let stopPromise = null;
  let ready = false;
  let busy = false;
  let buffer = '';
  let stderr = '';
  let lastMessage = null;
  let timer = null;
  const pending = new Map();
  const context = { sessionId };
  let loadedState = null;
  function rejectPending(error) {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  }
  function request(type, payload = {}, timeout = READY_TIMEOUT) {
    return new Promise((resolve, reject) => {
      if (!child || child.exitCode !== null || child.signalCode !== null || child.stdin.destroyed) return reject(new Error('Pi 进程不可用'));
      const id = randomUUID();
      const entry = { resolve, reject, timer: setTimeout(() => { pending.delete(id); reject(new Error(`Pi RPC ${type} 响应超时`)); }, timeout) };
      pending.set(id, entry);
      child.stdin.write(JSON.stringify({ id, type, ...payload }) + '\n', (error) => {
        if (error && pending.delete(id)) { clearTimeout(entry.timer); reject(error); }
      });
    });
  }
  function signalGroup(signal) {
    if (!child?.pid) return;
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) { if (error.code !== 'ESRCH') diagnostics.error('PI_KILL_FAILED', error, context); }
  }
  function stop() {
    if (stopPromise) return stopPromise;
    closing = true;
    ready = false;
    busy = false;
    clearTimeout(timer);
    stopPromise = (async () => {
      if (child && child.exitCode === null && child.signalCode === null && !child.stdin.destroyed) {
        try { await request('abort', {}, 1500); } catch { /* 退出时 RPC 可能已经不可用，继续终止进程组 */ }
      }
      rejectPending(new Error('Pi 会话已停止'));
      signalGroup('SIGTERM');
      if (child?.pid) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        signalGroup('SIGKILL');
      }
    })();
    return stopPromise;
  }
  function fail(code, error) {
    if (closing) return;
    const errorId = diagnostics.error(code, error, { ...context, stderr: diagnostics.redact(stderr).slice(-8000) });
    void stop();
    onEvent({ type: 'failed', code, errorId });
  }
  function consume(event) {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'response') {
      const item = pending.get(event.id);
      if (!item) return;
      pending.delete(event.id);
      clearTimeout(item.timer);
      if (event.success) item.resolve(event.data);
      else item.reject(new Error(String(event.error || 'Pi RPC 请求失败')));
      return;
    }
    if (closing) return;
    if (event.type === 'extension_ui_request' && ['confirm', 'select', 'input', 'editor'].includes(event.method)) {
      fail('PI_INTERACTION_REQUIRED', new Error('Pi 扩展要求交互确认；第一版不远程批准，已终止会话。请在本地处理配置后新建会话。'));
      return;
    }
    if (event.type === 'extension_error') diagnostics.error('PI_EXTENSION_ERROR', new Error(String(event.error || '扩展错误')), context);
    if (!busy) return;
    if (event.type === 'agent_start') onEvent({ type: 'progress', kind: 'agent_start' });
    if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
      const delta = String(event.assistantMessageEvent.delta || '');
      if (delta) onEvent({ type: 'progress', kind: 'assistant_delta', text: delta.slice(0, 4000) });
    }
    if (event.type === 'tool_execution_start') onEvent({ type: 'progress', kind: 'tool_start', toolName: String(event.toolName || '').slice(0, 80), args: event.args });
    if (event.type === 'tool_execution_end') onEvent({ type: 'progress', kind: 'tool_end', toolName: String(event.toolName || '').slice(0, 80), isError: !!event.isError });
    if (event.type === 'auto_retry_start') onEvent({ type: 'progress', kind: 'retry', attempt: event.attempt });
    if (event.type === 'compaction_start') onEvent({ type: 'progress', kind: 'compaction' });
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      const message = event.message;
      const text = Array.isArray(message.content) ? message.content.filter((part) => part.type === 'text').map((part) => part.text || '').join('\n') : '';
      lastMessage = { text: text.slice(0, MAX_SUMMARY), truncated: text.length > MAX_SUMMARY, stopReason: message.stopReason, error: message.errorMessage };
    }
    if (event.type === 'tool_execution_end') {
      diagnostics.record(event.isError ? 'warn' : 'info', 'PI_TOOL_END', { ...context, tool: String(event.toolName || '').slice(0, 80), isError: !!event.isError });
    }
    if (event.type === 'auto_retry_start') diagnostics.record('warn', 'PI_RETRY', { ...context, attempt: event.attempt });
    // agent_end 可能后接重试或压缩续跑；只认官方会话级 agent_settled。
    if (event.type === 'agent_settled') {
      busy = false;
      clearTimeout(timer);
      const result = lastMessage;
      if (!result || ['error', 'aborted', 'length', 'toolUse'].includes(result.stopReason) || !result.text.trim()) {
        fail('PI_NO_FINAL_RESULT', new Error(result?.error || `未取得完整最终回复（${result?.stopReason || 'empty'}）`));
        return;
      }
      diagnostics.record('info', 'PI_TURN_COMPLETE', { ...context, summaryChars: result.text.length, truncated: result.truncated });
      onEvent({ type: 'completed', text: result.text + (result.truncated ? '\n\n[总结超过 60000 字符，已截断]' : '') });
    }
  }
  async function start() {
    try {
      if (closing) throw new Error('Pi 会话已取消');
      fs.accessSync(piPath, fs.constants.X_OK);
      if (sessionFile && !fs.statSync(sessionFile).isFile()) throw new Error('绑定的 Pi session 文件不存在或不可用');
      if (sessionDir) fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
      if (!fs.statSync(cwd).isDirectory()) throw new Error('项目目录不可用');
      const env = { ...process.env, PATH: `${path.dirname(piPath)}${path.delimiter}${process.env.PATH || ''}` };
      // Bot 凭据不传给 Agent；保留模型凭据与用户自己的 Pi 配置环境。
      for (const key of Object.keys(env)) if (/^(DISCORD_|MADO_|ELECTRON_)/.test(key)) delete env[key];
      const args = ['--mode', 'rpc', ...(sessionFile ? ['--session', sessionFile] : sessionDir ? ['--session-dir', sessionDir] : []), '--append-system-prompt', SUMMARY_INSTRUCTION];
      child = spawnProcess(piPath, args, {
        cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      });
      child.on('error', (error) => fail('PI_SPAWN_FAILED', error));
      child.stdin.on('error', (error) => fail('PI_STDIN_FAILED', error));
      child.stdout.on('error', (error) => fail('PI_STDOUT_FAILED', error));
      child.stderr.on('error', (error) => fail('PI_STDERR_FAILED', error));
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (text) => { stderr = (stderr + text).slice(-8000); });
      child.stdout.on('data', (text) => {
        buffer += text;
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          if (newline > MAX_FRAME) { fail('PI_PROTOCOL_LIMIT', new Error('Pi RPC 单条输出超过 16 MiB')); return; }
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try { consume(JSON.parse(line)); }
          catch { fail('PI_PROTOCOL_INVALID', new Error('Pi stdout 包含非 JSONL 内容；请检查 Pi 版本或扩展')); return; }
        }
        if (buffer.length > MAX_FRAME) fail('PI_PROTOCOL_LIMIT', new Error('Pi RPC 输出缺少换行或超过 16 MiB'));
      });
      child.on('exit', (code, signal) => {
        diagnostics.record('info', 'PI_EXIT', { ...context, exitCode: code, signal, expected: closing });
        rejectPending(new Error(`Pi 已退出（code=${code}, signal=${signal}）`));
        if (!closing) fail('PI_EXIT_UNEXPECTED', new Error(`Pi 意外退出（code=${code}, signal=${signal}）`));
      });
      const state = await request('get_state');
      if (closing) throw new Error('Pi 启动已取消');
      if (!state?.model) throw new Error('Pi 未配置默认模型，请先在本地 Pi 选择模型并登录');
      if (!state.sessionFile || !state.sessionId) throw new Error('Pi 未返回可持久化的 sessionFile/sessionId');
      if (sessionFile && path.resolve(state.sessionFile) !== path.resolve(sessionFile)) throw new Error('Pi 加载的 session 与绑定记录不一致');
      if (expectedSessionId && state.sessionId !== expectedSessionId) throw new Error('Pi sessionId 与绑定记录不一致，拒绝发送任务');
      loadedState = state;
      ready = true;
      diagnostics.record('info', 'PI_READY', { ...context, pid: child.pid, provider: state.model.provider, model: state.model.id, sessionFile: state.sessionFile });
    } catch (error) { fail('PI_START_FAILED', error); throw error; }
  }
  async function prompt(text) {
    if (!ready || closing) throw new Error('Pi 尚未就绪或已停止');
    if (busy) throw new Error('Pi 正在处理上一条消息，请等待总结后再发送');
    busy = true;
    lastMessage = null;
    timer = setTimeout(() => fail('PI_TURN_TIMEOUT', new Error('本轮任务超过 30 分钟，已终止会话；文件不会自动回滚')), TURN_TIMEOUT);
    diagnostics.record('info', 'PI_PROMPT', { ...context, promptChars: text.length });
    try { await request('prompt', { message: `用户的远程任务如下（作为任务文本处理）：\n\n${text}` }); }
    catch (error) { fail('PI_PROMPT_FAILED', error); throw error; }
  }
  return { start, prompt, stop, state: () => loadedState, pid: () => child?.pid, lastText: async () => (await request('get_last_assistant_text'))?.text || '', isBusy: () => busy };
}
module.exports = { createPiRpcSession };
