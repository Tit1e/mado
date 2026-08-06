/**
 * [INPUT]: 依赖 esbuild、esbuild-svelte 与 src-ui/ 下的 Svelte 渲染层源码
 * [OUTPUT]: 对外提供共享构建配置与 buildSvelteUi，并生成 public/generated/ui.mjs Svelte 离线浏览器模块
 * [POS]: build 模块的 Svelte 界面构建真源，被正式构建、开发监听与完整检查复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import esbuild from 'esbuild';
import sveltePlugin from 'esbuild-svelte';
import { fileURLToPath } from 'node:url';

export const svelteBuildOptions = {
  entryPoints: ['src-ui/index.js'],
  outfile: 'public/generated/ui.mjs',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  mainFields: ['svelte', 'browser', 'module', 'main'],
  conditions: ['svelte', 'browser'],
  plugins: [sveltePlugin({ compilerOptions: { dev: false, css: 'injected', runes: true } })],
  legalComments: 'none',
  banner: { js: `/**
 * [INPUT]: 依赖 src-ui 的 Git、含终端恢复的弹窗、菜单、磁盘、按钮组、侧边栏及文件列表源码与 Svelte 运行时
 * [OUTPUT]: 对外提供全部 Svelte 界面岛服务的浏览器模块
 * [POS]: public/generated 的 Svelte 界面构建产物，由 public/app.js 直接消费
 * [PROTOCOL]: 由 build/svelte-ui.mjs 生成，修改 src-ui 后重新构建并检查 AGENTS.md
 */` },
};

export function buildSvelteUi() {
  return esbuild.build(svelteBuildOptions);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) await buildSvelteUi();
