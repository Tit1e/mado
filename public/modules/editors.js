/**
 * [INPUT]: 依赖渲染层 state.theme、Monaco 与 Milkdown 浏览器资源
 * [OUTPUT]: 对外提供 createEditors 工厂，返回 Monaco 与 Crepe 编辑器适配器
 * [POS]: public/modules 的编辑器基础设施模块，被文本预览和编辑流程消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
export function createEditors(state) {
// ---------- Monaco 编辑器（本地 vendor，离线可用；加载失败回退 textarea）----------
const mona = {
  editor: null, _p: null,
  themeFor: { terminal: 'fb-dark', warm: 'fb-paper', editorial: 'fb-editorial' },
  themeName() { return this.themeFor[state.theme] || 'fb-dark'; },
  // 散文类（md/txt/字幕）默认软换行，代码不换行
  wraps(ex) { return ['md', 'markdown', 'txt', 'log', 'srt', 'vtt', 'ass'].includes(ex); },
  lang(ex) {
    const m = {
      js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
      json: 'json', json5: 'json', jsonc: 'json', md: 'markdown', markdown: 'markdown', html: 'html', htm: 'html', vue: 'html',
      css: 'css', scss: 'scss', less: 'less', py: 'python', go: 'go', rs: 'rust', java: 'java', rb: 'ruby', php: 'php',
      c: 'c', cpp: 'cpp', cc: 'cpp', h: 'cpp', hpp: 'cpp', cs: 'csharp', sh: 'shell', bash: 'shell', zsh: 'shell',
      yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', conf: 'ini', xml: 'xml', sql: 'sql', swift: 'swift', lua: 'lua', kt: 'kotlin', dart: 'dart', r: 'r',
    };
    return m[ex] || 'plaintext';
  },
  load() {
    if (this._p) return this._p;
    if (window.__noMonaco) return Promise.resolve(null);
    this._p = new Promise((resolve) => {
      if (window.monaco) { resolve(window.monaco); return; }
      // 语言服务 worker 走 blob 代理（同源），无 worker 也能用基础高亮
      window.MonacoEnvironment = {
        getWorkerUrl() {
          return URL.createObjectURL(new Blob([
            `self.MonacoEnvironment={baseUrl:'${location.origin}/vendor/monaco/'};importScripts('${location.origin}/vendor/monaco/vs/base/worker/workerMain.js');`,
          ], { type: 'text/javascript' }));
        },
      };
      const s = document.createElement('script');
      s.src = '/vendor/monaco/vs/loader.js';
      s.onload = () => {
        try {
          window.require.config({ paths: { vs: '/vendor/monaco/vs' } });
          window.require(['vs/editor/editor.main'], () => { this.defineThemes(window.monaco); resolve(window.monaco); }, () => resolve(null));
        } catch { resolve(null); }
      };
      s.onerror = () => { window.__noMonaco = 1; resolve(null); };
      document.head.appendChild(s);
    });
    return this._p;
  },
  // 三皮肤各配一套编辑器配色，和文件区、终端区同呼吸
  defineThemes(m) {
    m.editor.defineTheme('fb-dark', { base: 'vs-dark', inherit: true, rules: [], colors: { 'editor.background': '#0b0c0a', 'editor.foreground': '#d6dac9', 'editorLineNumber.foreground': '#4a4d42', 'editorCursor.foreground': '#cdf24b', 'editor.selectionBackground': '#cdf24b33', 'editor.lineHighlightBackground': '#ffffff08' } });
    m.editor.defineTheme('fb-paper', { base: 'vs', inherit: true, rules: [], colors: { 'editor.background': '#ece2d2', 'editor.foreground': '#4a3f30', 'editorLineNumber.foreground': '#b3a589', 'editorCursor.foreground': '#cc785c', 'editor.selectionBackground': '#cc785c33', 'editor.lineHighlightBackground': '#00000008' } });
    m.editor.defineTheme('fb-editorial', { base: 'vs', inherit: true, rules: [], colors: { 'editor.background': '#eae5d8', 'editor.foreground': '#1a1a1a', 'editorLineNumber.foreground': '#9a958a', 'editorCursor.foreground': '#ff433d', 'editor.selectionBackground': '#ff433d22', 'editor.lineHighlightBackground': '#00000008' } });
  },
  retheme() { if (this.editor && window.monaco) window.monaco.editor.setTheme(this.themeName()); },
  // 只读并排 diff：HEAD 版本 vs 工作区当前内容，复用 editor 槽位让 disposeIfAny 统一回收
  openDiff(host, original, modified, ex) {
    const monaco = window.monaco;
    const lang = this.lang(ex);
    const orig = monaco.editor.createModel(original || '', lang);
    const mod = monaco.editor.createModel(modified || '', lang);
    const de = monaco.editor.createDiffEditor(host, {
      theme: this.themeName(), readOnly: true, automaticLayout: true, renderSideBySide: true,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace',
      fontSize: 12.5, lineHeight: 1.6, minimap: { enabled: false }, scrollBeyondLastLine: false,
    });
    de.setModel({ original: orig, modified: mod });
    this._models = [orig, mod];
    this.editor = de;
    return de;
  },
  disposeIfAny() {
    if (this.editor) { try { this.editor.dispose(); } catch { /* */ } this.editor = null; }
    if (this._models) { this._models.forEach((m) => { try { m.dispose(); } catch { /* */ } }); this._models = null; }
  },
};

// ---------- Milkdown Crepe（Notion 式所见即所得 Markdown；本地 vendor，离线可用）----------
const crepe = {
  editor: null, _p: null,
  load() {
    if (this._p) return this._p;
    if (window.__noCrepe) return Promise.resolve(null);
    this._p = new Promise((resolve) => {
      if (window.MadoCrepe) { resolve(window.MadoCrepe); return; }
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/vendor/milkdown/milkdown.css';
      document.head.appendChild(link);
      const s = document.createElement('script'); s.src = '/vendor/milkdown/milkdown.js';
      s.onload = () => resolve(window.MadoCrepe || null);
      s.onerror = () => { window.__noCrepe = 1; resolve(null); };
      document.head.appendChild(s);
    });
    return this._p;
  },
  disposeIfAny() { if (this.editor) { try { this.editor.destroy(); } catch { /* */ } this.editor = null; } },
};


  return { mona, crepe };
}
