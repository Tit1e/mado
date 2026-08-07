/**
 * [INPUT]: 依赖 happy-dom 测试环境、public/index.html 与 public/modules/ui-controller.js
 * [OUTPUT]: 验证左上角 Logo 的原始分辨率与 36px 显示尺寸、Icon Composer 图标、历史备份、指南与事件链
 * [POS]: tests/frontend 的使用指南回归测试，保证首次状态与常驻帮助入口互不干扰
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { installDom, loadRendererModule } from './dom-environment.mjs';

const { createUiController } = await loadRendererModule('ui-controller');

function createController() {
  const noop = () => {};
  const deps = new Proxy({
    $: (selector) => document.querySelector(selector),
    state: {}, follow: {}, runtime: {},
  }, {
    get(target, key) { return key in target ? target[key] : noop; },
  });
  return createUiController(deps);
}

test('左上角 Logo 保留原始分辨率并显示为 36px，网页与指南使用 Icon Composer 图标', async () => {
  const root = new URL('../../', import.meta.url);
  const [index, controller, icons, sidebarCss, publicIcon, publicLogo, buildIcon, dockIcon, icns, ...backups] = await Promise.all([
    readFile(new URL('public/index.html', root), 'utf8'),
    readFile(new URL('public/modules/ui-controller.js', root), 'utf8'),
    readFile(new URL('public/modules/icons.js', root), 'utf8'),
    readFile(new URL('public/styles/sidebar.css', root), 'utf8'),
    readFile(new URL('public/assets/mado-icon.png', root)),
    readFile(new URL('public/assets/mado-logo.png', root)),
    readFile(new URL('build/icon-1024.png', root)),
    readFile(new URL('build/icon.png', root)),
    readFile(new URL('build/icon.icns', root)),
    readFile(new URL('build/icon-1024.legacy-box.png', root)),
    readFile(new URL('build/icon.legacy-box.png', root)),
    readFile(new URL('build/icon.legacy-box.icns', root)),
    readFile(new URL('build/icon-design.legacy-box.html', root)),
    readFile(new URL('build/logo.legacy-box.svg', root)),
    readFile(new URL('build/icon-1024.legacy-v2.12.1.png', root)),
    readFile(new URL('build/icon.legacy-v2.12.1.png', root)),
    readFile(new URL('build/icon.legacy-v2.12.1.icns', root)),
  ]);
  const sourceConfig = JSON.parse(await readFile(new URL('build/Mado.icon/icon.json', root), 'utf8'));
  const sourceImageName = sourceConfig.groups[0].layers[0]['image-name'];
  const sourceImage = await readFile(new URL(`build/Mado.icon/Assets/${sourceImageName}`, root));
  assert.match(index, /rel="icon"[^>]+mado-icon\.png/);
  assert.match(index, /class="logo"><img src="\/assets\/mado-logo\.png" alt=""/);
  assert.match(controller, /class="guide-logo"><img src="\/assets\/mado-icon\.png" alt=""/);
  assert.match(sidebarCss, /\.brand \.logo \{ width: 36px; height: 36px;[^}]+flex: 0 0 36px;/);
  assert.doesNotMatch(icons, /\bbox:\s*'<path/);
  assert.equal(publicIcon.compare(buildIcon), 0);
  assert.equal(sourceConfig.fill.solid.startsWith('display-p3:'), true);
  assert.equal(sourceConfig.groups[0].translucency.enabled, true);
  assert.ok(sourceImage.length > 0);
  assert.deepEqual([publicLogo.readUInt32BE(16), publicLogo.readUInt32BE(20)], [1024, 1024]);
  assert.equal(publicLogo[25], 6);
  assert.deepEqual([buildIcon.readUInt32BE(16), buildIcon.readUInt32BE(20)], [1024, 1024]);
  assert.deepEqual([dockIcon.readUInt32BE(16), dockIcon.readUInt32BE(20)], [512, 512]);
  assert.equal(icns.toString('ascii', 0, 4), 'icns');
  backups.forEach((backup) => assert.ok(backup.length > 0));
});

test('首次使用显示指南并在确认后记录完成状态', () => {
  const dom = installDom();
  try {
    const ui = createController();
    assert.equal(ui.maybeShowGuide(), true);
    assert.ok(document.querySelector('.guide-overlay'));
    assert.deepEqual([...document.querySelectorAll('.guide-shortcuts kbd')].map((item) => item.textContent), [
      '⌘K', '/', '⌘↵', '↑↓ / ↵ / Esc', '⌘⇧T', '⌘⇧N', '⌘T / ⌘W', '⌘1–9', '⌘⇧R', '⌘B / ⌘[',
    ]);
    assert.deepEqual([...document.querySelectorAll('.guide-features b')].map((item) => item.textContent), [
      '找文件与预览', '启动 Agent', '跟踪与核对改动', '多终端工作', '管理项目',
    ]);
    assert.equal(document.querySelector('#guide-ok').textContent, '开始使用');
    assert.equal(localStorage.getItem('mado_guided'), null);
    document.querySelector('#guide-ok').click();
    assert.equal(localStorage.getItem('mado_guided'), '1');
    assert.equal(document.querySelector('.guide-overlay'), null);
    assert.equal(ui.maybeShowGuide(), false);
  } finally { dom.cleanup(); }
});

test('手动打开指南不改首次状态且不会叠加弹窗', () => {
  const dom = installDom();
  try {
    const ui = createController();
    assert.equal(ui.showGuide(), true);
    assert.equal(ui.showGuide(), false);
    assert.equal(document.querySelectorAll('.guide-overlay').length, 1);
    assert.equal(document.querySelector('#guide-ok').textContent, '关闭指南');
    document.querySelector('#guide-ok').click();
    assert.equal(localStorage.getItem('mado_guided'), null);
  } finally { dom.cleanup(); }
});

test('顶栏使用指南按钮位于终端按钮右侧并连接到强制打开方法', async () => {
  const root = new URL('../../', import.meta.url);
  const [index, controller] = await Promise.all([
    readFile(new URL('public/index.html', root), 'utf8'),
    readFile(new URL('public/modules/ui-controller.js', root), 'utf8'),
  ]);
  assert.match(index, /id="btn-guide"[^>]*title="使用指南"[^>]*aria-label="使用指南"/);
  assert.ok(index.indexOf('id="btn-guide"') > index.indexOf('id="btn-terminal"'));
  assert.match(controller, /\$\('#btn-guide'\)\.onclick = \(\) => showGuide\(\)/);
});

test('使用指南的全部中文文案都有英文词条', async () => {
  const dom = installDom();
  try {
    createController().showGuide();
    const source = await readFile(new URL('../../public/i18n-dict.js', import.meta.url), 'utf8');
    const context = { window: {} };
    vm.runInNewContext(source, context);
    const selectors = '.guide-card h2, .guide-lead, .guide-card h3, .guide-features b, .guide-features span, .guide-shortcuts span, .guide-reopen, #guide-ok';
    const texts = [...document.querySelectorAll(selectors)].map((item) => item.textContent.trim());
    texts.push('开始使用');
    texts.filter((text) => /[\u3400-\u9fff]/.test(text)).forEach((text) => {
      assert.equal(typeof context.window.MADO_DICT[text], 'string', `缺少英文词条：${text}`);
    });
  } finally { dom.cleanup(); }
});
