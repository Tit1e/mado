/**
 * [INPUT]: 依赖渲染层 state.theme 与浏览器 window
 * [OUTPUT]: 对外提供 createIcons 工厂，返回文件图标、界面图标与终端文件链接规则
 * [POS]: public/modules 的无状态图标叶子模块，被渲染、预览和终端模块消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
export function createIcons(state) {
// ---------- SVG 图标系统（替代 emoji，统一矢量审美） ----------
const SVG = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  text: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  pdf: '<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/>',
  data: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="12" y1="3" x2="12" y2="21"/>',
  json: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 1 2 2 2 2 0 0 1-2 2v5a2 2 0 0 1-2 2h-1"/>',
  archive: '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>',
  // UI 装饰图标（统一矢量，替代散落的 emoji）
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  link: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  term: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  clip: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  pen: '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>',
  edit3: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  gitbranch: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
  settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  maximize: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
  minimize: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>',
  undo: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  redo: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  // 高辨识度文件类型图标
  md: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M6 15.5V9l3 3 3-3v6.5"/><path d="M17 9v4.5"/><path d="M14.8 12.5L17 15l2.2-2.5"/>',
  html: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="9.3 12.5 7.5 14.5 9.3 16.5"/><polyline points="14.7 12.5 16.5 14.5 14.7 16.5"/>',
  pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M7.6 13.5h1.3a1.2 1.2 0 0 1 0 2.4H7.6zm0 0v4.2"/><path d="M12.4 13.5v4.2h1a1.5 1.5 0 0 0 1.5-1.5v-1.2a1.5 1.5 0 0 0-1.5-1.5z"/>',
};
// 按扩展名优先匹配的专属图标（比按 kind 更精准、辨识度更高）
const ICON_BY_EXT = { md: 'md', markdown: 'md', html: 'html', htm: 'html', pdf: 'pdf' };
// UI 图标快捷函数（默认 currentColor，随主题文字色自适应）
function ic(name, color, size) { return svgWrap(SVG[name], color || 'currentColor', size || 16, false); }
// ext → 类别 + 颜色
const EXT_KIND = {
  js: ['code', '#e8c95b'], mjs: ['code', '#e8c95b'], cjs: ['code', '#e8c95b'], jsx: ['code', '#5bc9e8'],
  ts: ['code', '#5b9ae8'], tsx: ['code', '#5b9ae8'], py: ['code', '#5b90c9'], go: ['code', '#5bc9d6'],
  rs: ['code', '#d68a5b'], swift: ['code', '#e8825b'], java: ['code', '#d68a5b'], rb: ['code', '#e85b5b'],
  c: ['code', '#7b9ae8'], cpp: ['code', '#7b9ae8'], h: ['code', '#7b9ae8'], php: ['code', '#9a7be8'],
  vue: ['code', '#5bd6a0'], sh: ['code', '#9aa3b2'], bash: ['code', '#9aa3b2'], lua: ['code', '#5b9ae8'],
  html: ['code', '#e87b5b'], htm: ['code', '#e87b5b'], css: ['code', '#5b9ae8'], scss: ['code', '#e85b9a'],
  json: ['json', '#e8c95b'], json5: ['json', '#e8c95b'], yml: ['json', '#d65b9a'], yaml: ['json', '#d65b9a'],
  toml: ['json', '#9a7be8'], ini: ['json', '#9aa3b2'], env: ['json', '#e8c95b'], xml: ['code', '#9aa3b2'],
  md: ['text', '#7bc9e8'], markdown: ['text', '#7bc9e8'], txt: ['text', '#9aa3b2'], log: ['text', '#9aa3b2'],
  csv: ['data', '#5bd6a0'], tsv: ['data', '#5bd6a0'], sql: ['data', '#e8a85b'],
  zip: ['archive', '#e8c95b'], rar: ['archive', '#e8c95b'], '7z': ['archive', '#e8c95b'],
  gz: ['archive', '#e8c95b'], tar: ['archive', '#e8c95b'],
};
const KIND_COLOR = { dir: '#6d8bff', image: '#5bd6a0', video: '#9a7be8', audio: '#e85b9a', pdf: '#e85b5b', text: '#9aa3b2', other: '#7a8294' };
// 缩略图加载失败时的回退图标
window.__svgVideo = svgWrap(SVG.video, KIND_COLOR.video, 34);
window.__svgImg = svgWrap(SVG.image, KIND_COLOR.image, 34);

// 图标配色随皮肤变化
function iconColorFor(e) {
  const ex = (e.name.split('.').pop() || '').toLowerCase();
  const t = state.theme;
  if (t === 'warm') {
    if (e.isDir) return '#c0714f';
    if (['md', 'markdown', 'txt', 'pdf'].includes(ex)) return '#a0895c';
    if (['csv', 'tsv', 'sql'].includes(ex)) return '#8a7a48';
    return '#9b8b6e';
  }
  if (t === 'editorial') {
    if (['html', 'htm'].includes(ex)) return '#ff433d';
    if (['md', 'markdown'].includes(ex)) return '#0000ee';
    if (e.kind === 'data' || ['csv', 'tsv'].includes(ex)) return '#00a33e';
    // 单色图标跟随容器颜色，选中黑底时由主题样式统一反白。
    return 'currentColor';
  }
  // terminal：暖色多彩，文件夹用中性灰绿不抢 volt
  if (e.isDir) return '#9aa08a';
  if (EXT_KIND[ex]) return EXT_KIND[ex][1];
  return KIND_COLOR[e.kind] || KIND_COLOR.other;
}
function iconSvg(e, size = 22) {
  const rich = richIcon(e, size); // 强色实体字形优先
  if (rich) return rich;
  const color = iconColorFor(e);
  if (e.isDir) return svgWrap(SVG.folder, color, size, true);
  const ex = (e.name.split('.').pop() || '').toLowerCase();
  let shape = SVG[e.kind] || SVG.file;
  if (EXT_KIND[ex]) shape = SVG[EXT_KIND[ex][0]];
  if (ICON_BY_EXT[ex]) shape = SVG[ICON_BY_EXT[ex]]; // 专属图标优先（md/html/pdf）
  return svgWrap(shape, color, size);
}
function svgWrap(inner, color, size, fill) {
  const isCur = color === 'currentColor';
  const fillVal = fill ? (isCur ? 'currentColor' : color + '22') : 'none';
  const fillOp = (fill && isCur) ? ' fill-opacity="0.15"' : '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fillVal}"${fillOp} stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

// ---------- 强色实体文件图标（10x 识别度）----------
// 文档族：实色页面 + 折角 + 白色短标签；代码族：品牌色圆角徽章 + 字母；媒体/压缩各有专属形。
// 颜色烧死在图标里，跨三套皮肤都醒目——一眼认出「这是个 PDF / JS / 压缩包」。
function gWrap(size, inner) { return `<svg class="rich-glyph" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">${inner}</svg>`; }
function gDoc(color, fold) {
  return `<path d="M5 3.6A1.6 1.6 0 0 1 6.6 2H14l5 5v11.4A1.6 1.6 0 0 1 17.4 20H6.6A1.6 1.6 0 0 1 5 18.4z" fill="${color}"/>`
    + `<path d="M14 2l5 5h-3.4A1.6 1.6 0 0 1 14 5.4z" fill="${fold}"/>`;
}
function gLabel(t, fs) { return `<text x="11.6" y="16.6" text-anchor="middle" font-family="-apple-system,'Helvetica Neue',Arial,sans-serif" font-weight="800" font-size="${fs}" letter-spacing="0.1" fill="#fff">${t}</text>`; }
function gBadge(color) { return `<rect x="3" y="3" width="18" height="18" rx="5" fill="${color}"/>`; }
function gInit(t, fs, color) { return `<text x="12" y="15.7" text-anchor="middle" font-family="-apple-system,'Helvetica Neue',Arial,sans-serif" font-weight="800" font-size="${fs}" fill="${color}">${t}</text>`; }
// 文档族：[标签, 字号, 主体色, 折角色]
const DOC_TYPES = {
  pdf: ['PDF', 5, '#E64A3B', '#C23E31'],
  md: ['MD', 7, '#3B82F6', '#2E68C8'], markdown: ['MD', 7, '#3B82F6', '#2E68C8'],
  html: ['&lt;&gt;', 7, '#E8662A', '#C4541F'], htm: ['&lt;&gt;', 7, '#E8662A', '#C4541F'],
  css: ['CSS', 5, '#2D6FD6', '#2459AC'], scss: ['SCSS', 4, '#CF649A', '#A94E7C'], less: ['LESS', 4, '#2D5B8A', '#244A70'],
  json: ['{ }', 7, '#A6824C', '#856A3E'], json5: ['{ }', 7, '#A6824C', '#856A3E'],
  yml: ['YML', 5, '#9C5BD6', '#7E49AC'], yaml: ['YAML', 4.2, '#9C5BD6', '#7E49AC'], toml: ['TOML', 4.2, '#9C5BD6', '#7E49AC'],
  xml: ['XML', 5, '#5E8A3E', '#4A6E31'], svg: ['SVG', 5, '#E8923A', '#C4761F'],
  csv: ['CSV', 5, '#1FAE5A', '#188F4A'], tsv: ['TSV', 5, '#1FAE5A', '#188F4A'],
  sql: ['SQL', 5, '#C77D2E', '#A4661F'],
  doc: ['DOC', 5, '#2B579A', '#21457A'], docx: ['DOC', 5, '#2B579A', '#21457A'],
  xls: ['XLS', 5, '#1D6F42', '#155632'], xlsx: ['XLS', 5, '#1D6F42', '#155632'],
  ppt: ['PPT', 5, '#C43E1C', '#9E3216'], pptx: ['PPT', 5, '#C43E1C', '#9E3216'],
  log: ['LOG', 5, '#7A8290', '#626977'], txt: ['TXT', 5, '#7A8290', '#626977'],
};
// 代码族：[字母, 字号, 徽章色, 字色]
const CODE_BADGES = {
  js: ['JS', 8, '#F0DB4F', '#1A1A1A'], mjs: ['JS', 8, '#F0DB4F', '#1A1A1A'], cjs: ['JS', 8, '#F0DB4F', '#1A1A1A'],
  jsx: ['JSX', 6, '#61DAFB', '#1A1A1A'],
  ts: ['TS', 8, '#3178C6', '#fff'], tsx: ['TSX', 6, '#3178C6', '#fff'],
  py: ['PY', 8, '#3776AB', '#FFE05B'],
  go: ['GO', 7.5, '#00ACD7', '#fff'], rs: ['RS', 8, '#CE7B43', '#fff'],
  java: ['JV', 8, '#E7700E', '#fff'], kt: ['KT', 8, '#A97BFF', '#fff'],
  rb: ['RB', 8, '#CC342D', '#fff'], php: ['PHP', 6, '#7A86B8', '#fff'],
  c: ['C', 9, '#5C6BC0', '#fff'], h: ['H', 9, '#5C6BC0', '#fff'], cpp: ['C++', 6, '#5C6BC0', '#fff'], cc: ['C++', 6, '#5C6BC0', '#fff'],
  vue: ['Vue', 6, '#41B883', '#fff'], swift: ['SW', 8, '#F05138', '#fff'], dart: ['DT', 8, '#0A9EDC', '#fff'],
  sh: ['&gt;_', 8, '#33373D', '#3FD46A'], bash: ['&gt;_', 8, '#33373D', '#3FD46A'], zsh: ['&gt;_', 8, '#33373D', '#3FD46A'],
};
const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'gz', 'tar', 'tgz', 'bz2', 'xz']);
// 终端裸文件名识别的扩展名白名单：没有它 e.g/node.js/v1.2 这类词全是误报下划线
// 首尾边界都含全角胶水标点：「生成了 a.png、b.png」顿号列举的两个名字才都识别得到
const TERM_LINK_RE_BARE = /(?<=^|[\s'"`(\[（【>：:=；，。、？！])[\p{L}\p{N}_@][\p{L}\p{N}_.\-@/]*\.(?:md|markdown|txt|pdf|png|jpe?g|gif|webp|svg|avif|heic|icns|ico|mp4|mov|webm|mkv|mp3|wav|m4a|flac|json|jsonl|js|mjs|cjs|ts|tsx|jsx|css|scss|sass|less|html?|xml|ya?ml|toml|ini|conf|lock|log|sh|zsh|bash|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sql|csv|tsv|xlsx?|docx?|pptx?|key|numbers|pages|zip|tar|gz|tgz|dmg|app|plist|epub|srt|vtt|command)(?=$|[.\s'"`)\],:;。，）】、？！；：])/gu;
// 文件夹：干净扁平的单色实心文件夹（强色 + 简洁几何，不做作）
function gFolder(size, color) {
  return `<svg class="rich-glyph" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">`
    + `<path d="M3.6 5.5h4.4a1.2 1.2 0 0 1 .85.35l1.3 1.3a1.2 1.2 0 0 0 .85.35H20a1.6 1.6 0 0 1 1.6 1.6v8.45A1.6 1.6 0 0 1 20 19.1H4A1.6 1.6 0 0 1 2.4 17.5V6.7A1.2 1.2 0 0 1 3.6 5.5z" fill="${color}"/>`
    + `</svg>`;
}
function richIcon(e, size) {
  if (e.isDir) return gFolder(size, iconColorFor(e));
  const ex = (e.name.split('.').pop() || '').toLowerCase();
  if (DOC_TYPES[ex]) { const [l, fs, c, f] = DOC_TYPES[ex]; return gWrap(size, gDoc(c, f) + gLabel(l, fs)); }
  if (CODE_BADGES[ex]) { const [l, fs, c, t] = CODE_BADGES[ex]; return gWrap(size, gBadge(c) + gInit(l, fs, t)); }
  if (ARCHIVE_EXT.has(ex)) {
    return gWrap(size, `<rect x="4" y="3.5" width="16" height="17" rx="2.2" fill="#E0A23B"/><rect x="4" y="3.5" width="16" height="17" rx="2.2" fill="#000" opacity="0.06"/>`
      + `<rect x="10.6" y="3.5" width="2.8" height="17" fill="#C8862A"/>`
      + `<rect x="10.6" y="8" width="2.8" height="3" rx="0.5" fill="#fff8e6"/><rect x="11.4" y="11" width="1.2" height="3.4" rx="0.6" fill="#fff8e6"/>`);
  }
  if (e.kind === 'audio') {
    return gWrap(size, gBadge('#E0457B') + `<g stroke="#fff" stroke-width="1.5" stroke-linecap="round"><line x1="8" y1="10" x2="8" y2="14"/><line x1="10.7" y1="8" x2="10.7" y2="16"/><line x1="13.3" y1="9.5" x2="13.3" y2="14.5"/><line x1="16" y1="7.5" x2="16" y2="16.5"/></g>`);
  }
  if (e.kind === 'video') {
    return gWrap(size, gBadge('#7C5CE0') + `<path d="M10 8.5l5 3.5-5 3.5z" fill="#fff"/>`);
  }
  if (e.kind === 'image') {
    return gWrap(size, gBadge('#2BB6A3') + `<circle cx="9" cy="9.5" r="1.6" fill="#fff"/><path d="M5 16l3.5-3.5 2.5 2.5L14.5 11 19 16z" fill="#fff"/>`);
  }
  return null; // 未知类型回退到细线通用图标
}
// 缩略图加载失败时的回退（覆盖前面用细线图标的版本，改用强色实体字形）
window.__svgImg = richIcon({ name: '_.jpg', kind: 'image' }, 40);
window.__svgVideo = richIcon({ name: '_.mp4', kind: 'video' }, 40);


  return { SVG, svgWrap, ic, iconSvg, richIcon, iconColorFor, TERM_LINK_RE_BARE };
}
