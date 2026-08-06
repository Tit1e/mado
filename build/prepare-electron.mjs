/**
 * [INPUT]: 依赖 electron、@electron/get、官方 checksums 与 macOS ditto 解压工具
 * [OUTPUT]: 对外提供 prepareElectron，在 npm 11 + Node 26 半安装时补全 Electron.app 与 path.txt
 * [POS]: build 模块的 Electron 开发依赖准备器，由 npm postinstall 在依赖树稳定后幂等执行
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

function platformPath(platform) {
  if (platform === 'darwin' || platform === 'mas') return 'Electron.app/Contents/MacOS/Electron';
  if (platform === 'win32') return 'electron.exe';
  if (platform === 'freebsd' || platform === 'linux') return 'electron';
  throw new Error(`不支持的 Electron 平台: ${platform}`);
}

export async function prepareElectron(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  const electronDir = path.join(root, 'node_modules', 'electron');
  const packageFile = path.join(electronDir, 'package.json');
  if (!fs.existsSync(packageFile)) return { skipped: true, reason: 'electron-not-installed' };

  const platform = process.env.npm_config_platform || process.platform;
  const arch = process.env.npm_config_arch || process.arch;
  const executable = platformPath(platform);
  const distDir = path.join(electronDir, 'dist');
  const executableFile = path.join(distDir, executable);
  const pathFile = path.join(electronDir, 'path.txt');
  if (fs.existsSync(pathFile) && fs.existsSync(executableFile)) return { skipped: true, reason: 'already-ready' };
  if (platform !== 'darwin') throw new Error('Electron 依赖未完整安装；Node 26 兼容补全当前仅支持 macOS');

  const { version } = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  const { downloadArtifact } = require('@electron/get');
  const checksums = JSON.parse(fs.readFileSync(path.join(electronDir, 'checksums.json'), 'utf8'));
  const zipFile = await downloadArtifact({ version, artifactName: 'electron', platform, arch, checksums });

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
  execFileSync('/usr/bin/ditto', ['-x', '-k', zipFile, distDir], { stdio: 'inherit' });
  const bundledTypes = path.join(distDir, 'electron.d.ts');
  if (fs.existsSync(bundledTypes)) fs.renameSync(bundledTypes, path.join(electronDir, 'electron.d.ts'));
  if (!fs.existsSync(executableFile)) throw new Error('Electron.app 解压后缺少可执行文件');
  fs.writeFileSync(pathFile, executable);
  console.log(`[mado] 已补全 Electron ${version} (${arch})`);
  return { skipped: false, executable: executableFile };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) await prepareElectron();
