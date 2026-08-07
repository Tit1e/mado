/**
 * [INPUT]: 依赖浏览器原生 String.localeCompare 的中文区域与数字感知比较能力
 * [OUTPUT]: 对外提供 compareNames，统一文件与项目名称的自然排序规则
 * [POS]: public/modules 的名称排序唯一真源，被文件浏览控制器与 Svelte 项目列表消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
export function compareNames(a, b) {
  return a.localeCompare(b, 'zh', { numeric: true });
}
