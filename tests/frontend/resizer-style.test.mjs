/**
 * [INPUT]: 依赖 public/styles/sidebar.css、preview.css 与 terminal.css 的分割线样式
 * [OUTPUT]: 验证侧边栏与终端分割线保留宽命中区，并由手柄自身绘制方向一致的 1px 悬停线；预览已改为终端浮层不再有分割线
 * [POS]: tests/frontend 的分割线视觉契约测试，防止各区域分割线宽度分叉或伪元素再次跨出手柄区域
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const previewCss = await readFile(new URL('../../public/styles/preview.css', import.meta.url), 'utf8');
const sidebarCss = await readFile(new URL('../../public/styles/sidebar.css', import.meta.url), 'utf8');
const terminalCss = await readFile(new URL('../../public/styles/terminal.css', import.meta.url), 'utf8');

test('分割线保留 6px 拖拽命中区', () => {
  assert.match(sidebarCss, /#sidebar-resizer\s*\{[^}]*width:\s*6px/);
  assert.match(terminalCss, /#terminal-resizer\s*\{[^}]*flex:\s*0 0 6px/);
});

test('侧边栏手柄自身绘制居中的 1px 主题线', () => {
  assert.match(sidebarCss, /#sidebar-resizer\s*\{[^}]*background-image:\s*linear-gradient\(var\(--accent\), var\(--accent\)\)[^}]*background-position:\s*center[^}]*background-repeat:\s*no-repeat[^}]*background-size:\s*1px 100%/);
  assert.match(sidebarCss, /#sidebar-resizer:hover, #sidebar-resizer\.dragging\s*\{[^}]*opacity:/);
  assert.doesNotMatch(sidebarCss, /#sidebar-resizer::after/);
});

test('终端手柄由自身背景绘制居中的 1px 主题线，预览浮层无分割线', () => {
  assert.match(terminalCss, /#terminal-resizer\s*\{[^}]*background-image:\s*linear-gradient\(var\(--accent\), var\(--accent\)\)[^}]*background-position:\s*center[^}]*background-repeat:\s*no-repeat/);
  assert.match(terminalCss, /\.dock-right #terminal-resizer\s*\{[^}]*background-size:\s*1px 100%/);
  assert.match(terminalCss, /\.dock-bottom #terminal-resizer\s*\{[^}]*background-size:\s*100% 1px/);
  assert.doesNotMatch(previewCss, /#preview-resizer/);
  assert.doesNotMatch(terminalCss, /#terminal-resizer::after/);
});
