/**
 * [INPUT]: 依赖 public/index.html、ui-controller.js、agent-launcher.js 与 Pi 图标资产
 * [OUTPUT]: 验证 Codex/Pi 图标入口对称、无右键动作、共享继续设置且不暴露 Pi 历史选择
 * [POS]: tests/frontend 的 Agent 快速启动界面契约测试，固定用户确认后的简洁交互
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');

async function source(file) { return readFile(path.join(root, file), 'utf8'); }

test('Codex 与 Pi 使用对称单击入口且没有右键功能', async () => {
  const [html, controller] = await Promise.all([source('public/index.html'), source('public/modules/ui-controller.js')]);
  assert.match(html, /id="term-codex"[\s\S]*id="term-pi"/);
  assert.match(html, /id="term-pi"[\s\S]*src="\/assets\/pi\.svg"/);
  assert.doesNotMatch(controller, /oncontextmenu|showAgentLaunchMenu/);
  assert.match(controller, /term\.launchAgent\('codex'\)/);
  assert.match(controller, /term\.launchAgent\('pi'\)/);
});

test('两个 Agent 共用继续最近会话设置并由固定映射选择参数', async () => {
  const [controller, launcher] = await Promise.all([source('public/modules/ui-controller.js'), source('public/modules/agent-launcher.js')]);
  assert.equal((controller.match(/data-setting="agent-resume-last"/g) || []).length, 2);
  assert.doesNotMatch(controller, /pi-resume-last|codex-resume-last/);
  assert.match(controller, /mado_agent_resume_last/);
  assert.match(controller, /mado_codex_resume_last/);
  assert.match(launcher, /command: 'codex resume --last'/);
  assert.match(launcher, /command: 'pi -c'/);
  assert.doesNotMatch(launcher, /pi -r/);
});
