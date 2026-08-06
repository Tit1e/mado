/**
 * [INPUT]: 依赖 Node.js fs/path/os，在 Electron userData 下生成隔离的 zsh 启动文件
 * [OUTPUT]: 对外提供 createZshIntegration 与 consumeShellMarkers，安全继承嵌套 zsh 配置并认证顶层命令生命周期标记
 * [POS]: electron 模块的 Shell 集成边界，被 pty-service.js 用于准确追踪仍在运行的原始命令
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIX = '\x1b]777;mado;';
const SUFFIX = '\x07';

function isIntegrationDir(candidate, currentDir) {
  if (!candidate) return false;
  if (path.resolve(candidate) === path.resolve(currentDir)) return true;
  if (!path.normalize(candidate).endsWith(path.join('shell-integration', 'zsh'))) return false;
  try {
    const rc = fs.readFileSync(path.join(candidate, '.zshrc'), 'utf8');
    return rc.includes('_mado_preexec()') && rc.includes('mado;start;');
  } catch { return false; }
}

function createZshIntegration(userData, env = process.env) {
  const dir = path.join(userData, 'shell-integration', 'zsh');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const originalZdotdir = [env.MADO_ORIGINAL_ZDOTDIR, env.ZDOTDIR, os.homedir()]
    .find((candidate) => candidate && !isIntegrationDir(candidate, dir)) || os.homedir();
  const source = (name) => `[[ -r \"$MADO_ORIGINAL_ZDOTDIR/${name}\" ]] && source \"$MADO_ORIGINAL_ZDOTDIR/${name}\"\n`;
  fs.writeFileSync(path.join(dir, '.zshenv'), source('.zshenv') + `export ZDOTDIR=${JSON.stringify(dir)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, '.zprofile'), source('.zprofile'), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, '.zlogin'), source('.zlogin'), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, '.zlogout'), source('.zlogout'), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, '.zshrc'), source('.zshrc') + [
    'autoload -Uz add-zsh-hook',
    'typeset -g _mado_shell_token="$MADO_SHELL_TOKEN"',
    'typeset +x _mado_shell_token',
    'unset MADO_SHELL_TOKEN',
    'typeset -gr _mado_shell_token',
    '_mado_preexec() {',
    '  local encoded',
    '  encoded=$(printf %s "$1" | /usr/bin/base64 | /usr/bin/tr -d "\\n")',
    `  printf '${PREFIX}start;%s;%s${SUFFIX}' "$_mado_shell_token" "$encoded"`,
    '}',
    `_mado_precmd() { printf '${PREFIX}end;%s${SUFFIX}' "$_mado_shell_token" }`,
    'add-zsh-hook preexec _mado_preexec',
    'add-zsh-hook precmd _mado_precmd',
    '',
  ].join('\n'), { mode: 0o600 });
  return { dir, originalZdotdir };
}

function consumeShellMarkers(state, chunk, expectedToken, onMarker) {
  const input = (state.carry || '') + String(chunk || '');
  let visible = '';
  let cursor = 0;
  while (cursor < input.length) {
    const start = input.indexOf(PREFIX, cursor);
    if (start < 0) { visible += input.slice(cursor); state.carry = ''; return visible; }
    visible += input.slice(cursor, start);
    const end = input.indexOf(SUFFIX, start + PREFIX.length);
    if (end < 0) { state.carry = input.slice(start); return visible; }
    const payload = input.slice(start + PREFIX.length, end);
    if (expectedToken && payload === `end;${expectedToken}`) onMarker({ type: 'end' });
    else if (expectedToken && payload.startsWith(`start;${expectedToken};`)) {
      try {
        const command = Buffer.from(payload.slice(7 + expectedToken.length), 'base64').toString('utf8');
        if (command.length <= 16384) onMarker({ type: 'start', command });
      } catch { /* 非法标记只丢弃，不污染终端输出 */ }
    }
    cursor = end + SUFFIX.length;
  }
  state.carry = '';
  return visible;
}

module.exports = { createZshIntegration, consumeShellMarkers };
