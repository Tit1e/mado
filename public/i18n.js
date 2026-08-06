/**
 * [INPUT]: 依赖 i18n-dict.js 词典、index.html 语言开关 DOM、localStorage、语言配置 HTTP API 和 Electron 菜单桥接
 * [OUTPUT]: 对外提供 window.t、window.madoSetLang 与 MutationObserver 动态翻译能力
 * [POS]: public 模块的国际化运行层，以中文原文缓存驱动界面双向原地切换，不重载渲染进程
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
'use strict';
/**
 * Mado i18n —— 集中式翻译层。
 * 词典在 i18n-dict.js（中文原文为键）。保留节点原文，切换语言时重绘现有 DOM；
 * 新增和更新的界面节点由 MutationObserver 接管。用户内容区（预览/编辑器/终端）一律不碰。
 */
(() => {
  const saved = localStorage.getItem('mado_lang');
  const sys = (navigator.language || 'en').toLowerCase();
  let lang = saved === 'zh' || saved === 'en' ? saved : (sys.startsWith('zh') ? 'zh' : 'en');
  const textSources = new WeakMap();
  const textRendered = new WeakMap();
  const attrSources = new WeakMap();
  const attrRendered = new WeakMap();

  const HAN = /[\u3400-\u9fff\u300c\u300d\uff08\uff09\uff1a\uff1b\uff01\uff1f\u2026\u00b7]/;
  const SKIP = '#preview-body, #ed-host, .xterm, .milkdown, .lightbox, .cp-name, .cp-dir, #lang-toggle';
  const ATTRS = ['title', 'placeholder'];
  const dict = () => window.MADO_DICT || {};
  const rules = () => window.MADO_DICT_RULES || [];

  const trOne = (core) => {
    const hit = dict()[core];
    if (hit !== undefined) return hit;
    for (const [re, rep] of rules()) {
      const match = core.match(re);
      if (match) {
        try { return typeof rep === 'function' ? rep(match) : rep; } catch { /* 规则异常不挡显示 */ }
      }
    }
    return null;
  };

  const translate = (value) => {
    if (!value || !HAN.test(value)) return value;
    const core = value.trim();
    const whole = trOne(core);
    if (whole !== null) return value.replace(core, whole);
    // 复合文案（「刚刚 · 12 条消息 · 改了 16 个文件」）整段匹配不上：按 · 分段逐段翻。
    if (core.includes('·')) {
      const segments = core.split('·').map((item) => item.trim()).filter(Boolean);
      const parts = segments.map((item) => trOne(item) ?? item);
      if (parts.some((item, index) => item !== segments[index])) {
        const joined = parts.join(' · ') + (/·\s*$/.test(core) ? ' · ' : '');
        return value.replace(core, joined);
      }
    }
    return value;
  };

  const display = (source) => (lang === 'en' ? translate(source) : source);
  const skipped = (node) => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !!element?.closest(SKIP);
  };
  const mapsFor = (store, element) => {
    let values = store.get(element);
    if (!values) { values = new Map(); store.set(element, values); }
    return values;
  };

  function renderText(node) {
    if (skipped(node)) return;
    const value = node.nodeValue || '';
    const previous = textRendered.get(node);
    if (!textSources.has(node) || value !== previous) textSources.set(node, value);
    const output = display(textSources.get(node));
    textRendered.set(node, output);
    if (value !== output) node.nodeValue = output;
  }

  function renderAttributes(element) {
    if (skipped(element)) return;
    const sources = mapsFor(attrSources, element);
    const rendered = mapsFor(attrRendered, element);
    for (const attr of ATTRS) {
      const value = element.getAttribute(attr);
      if (value === null || value === '') {
        sources.delete(attr);
        rendered.delete(attr);
        continue;
      }
      if (!sources.has(attr) || value !== rendered.get(attr)) sources.set(attr, value);
      const output = display(sources.get(attr));
      rendered.set(attr, output);
      if (value !== output) element.setAttribute(attr, output);
    }
  }

  function visit(node) {
    if (node.nodeType === Node.TEXT_NODE) { renderText(node); return; }
    if (node.nodeType !== Node.ELEMENT_NODE || skipped(node)) return;
    renderAttributes(node);
    for (const child of [...node.childNodes]) visit(child);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') mutation.addedNodes.forEach(visit);
      else if (mutation.type === 'characterData') renderText(mutation.target);
      else renderAttributes(mutation.target);
    }
  });

  function wireToggle() {
    const toggle = document.getElementById('lang-toggle');
    if (!toggle) return;
    toggle.textContent = lang === 'zh' ? 'EN' : '中文';
    // 按钮文字已明确表示目标语言，保留气泡只会挤出窄侧栏。
    delete toggle.dataset.tip;
    toggle.removeAttribute('title');
    toggle.onclick = () => window.madoSetLang(lang === 'zh' ? 'en' : 'zh');
  }

  function applyLanguage(next) {
    lang = next;
    window.madoLang = lang;
    window.t = (value) => display(value);
    document.documentElement.lang = lang;
    wireToggle();
    if (document.body) visit(document.body);
  }

  function persistLanguage(next) {
    if (typeof window.fetch !== 'function') return Promise.resolve();
    return window.fetch('/api/lang', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: next }),
    })
      .then((response) => {
        if (!response.ok) throw new Error('语言配置保存失败');
        return response.json();
      })
      .then(() => window.madoLocale?.refreshMenu?.())
      .catch(() => {});
  }

  window.madoSetLang = (value) => {
    const next = value === 'en' || value === 'zh' ? value : lang;
    localStorage.setItem('mado_lang', next);
    applyLanguage(next);
    return persistLanguage(next);
  };
  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    applyLanguage(lang);
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
