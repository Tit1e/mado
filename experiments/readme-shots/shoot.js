/**
 * [INPUT]: 依赖 Electron 主进程、假 HOME、README 示例文件和三套界面主题
 * [OUTPUT]: 对外提供 README 使用的三套 CodexBox 实拍截图
 * [POS]: experiments/readme-shots 的截图生成入口，用于更新公开产品图片
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const FAKE_HOME = process.env.CODEXBOX_SCREENSHOT_HOME || '/tmp/codexbox-readme-shots';
process.env.HOME = FAKE_HOME;
process.env.CODEXBOX_DEV_PORT ||= '4621';
const { app, BrowserWindow } = require('electron');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function prepareHome() {
  ['Desktop', 'Documents', 'Downloads', 'Projects', 'Pictures', 'Notes'].forEach((name) => {
    fs.mkdirSync(path.join(FAKE_HOME, name), { recursive: true });
  });
  fs.writeFileSync(path.join(FAKE_HOME, 'README.md'), '# CodexBox\n\n本地文件驾驶舱，列表浏览、原地预览、内嵌终端。\n');
  fs.writeFileSync(path.join(FAKE_HOME, 'notes.md'), '# 今日记录\n\nCodex 正在整理当前项目。\n');
  fs.writeFileSync(path.join(FAKE_HOME, 'package.json'), JSON.stringify({ name: 'codexbox-sample', private: true }, null, 2));
}

async function waitForWindow() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      const ready = await win.webContents.executeJavaScript("!!document.querySelector('#file-area .row[data-idx]')").catch(() => false);
      if (ready) return win;
    }
    await sleep(100);
  }
  throw new Error('CodexBox window did not become ready');
}

async function capture(win, file) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ROOT, 'assets', file), image.toPNG());
  console.log('shot', file);
}

prepareHome();
require('../../electron/main.js');

app.whenReady().then(async () => {
  try {
    const win = await waitForWindow();
    win.setSize(1560, 950);
    win.center();
    await sleep(700);
    await win.webContents.executeJavaScript(`
      localStorage.setItem('codexbox_guided', '1');
      localStorage.setItem('codexbox_view', 'grid');
      localStorage.setItem('codexbox_gridsize', 'lg');
      document.querySelector('.guide-overlay')?.remove();
      [...document.querySelectorAll('.row[data-idx]')].find((row) => row.querySelector('.fname')?.textContent.includes('README.md'))?.click();
      document.querySelector('#btn-terminal')?.click();
    `);
    await sleep(700);
    await win.webContents.executeJavaScript("document.querySelector('#term-newtab')?.click()");
    await sleep(900);

    const contract = await win.webContents.executeJavaScript(`({
      list: !!document.querySelector('.list .row[data-idx]'),
      grid: !!document.querySelector('.grid'),
      viewControl: !!document.querySelector('#view-seg'),
      sizeControl: !!document.querySelector('#gridsize-seg')
    })`);
    if (!contract.list || contract.grid || contract.viewControl || contract.sizeControl) {
      throw new Error('list-only screenshot contract failed: ' + JSON.stringify(contract));
    }

    const shots = [
      { theme: '终端', file: 'screenshot-volt.png' },
      { theme: '档案', file: 'screenshot-archive.png' },
      { theme: '索引', file: 'screenshot-index.png' },
    ];
    for (const shot of shots) {
      await win.webContents.executeJavaScript(`
        [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === ${JSON.stringify(shot.theme)})?.click();
        document.querySelector('.guide-overlay')?.remove();
      `);
      await sleep(500);
      await capture(win, shot.file);
    }
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
