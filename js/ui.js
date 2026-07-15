/** DOM ヘルパー・共通パーツ */

/** タグ名 + 属性 + 子 から要素を作る。属性は on* でイベント、それ以外は setAttribute。 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/* ---------------- toast ---------------- */

let toastTimer = null;

export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------------- modal ---------------- */

/**
 * @returns {{close: Function, body: HTMLElement, foot: HTMLElement}}
 */
export function modal({ title, body, footer, onClose }) {
  const root = document.getElementById('modalRoot');

  const bodyEl = el('div', { class: 'modal-body' }, body);
  const footEl = footer ? el('div', { class: 'modal-foot' }, footer) : null;

  const close = () => {
    backdrop.remove();
    document.body.style.overflow = '';
    if (onClose) onClose();
  };

  const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    el('div', { class: 'modal-head' },
      el('h3', { text: title }),
      el('button', { class: 'x', 'aria-label': '閉じる', onclick: close }, '✕')
    ),
    bodyEl,
    footEl
  );

  const backdrop = el('div', {
    class: 'modal-backdrop',
    onclick: (e) => { if (e.target === backdrop) close(); },
  }, box);

  root.append(backdrop);
  document.body.style.overflow = 'hidden';

  return { close, body: bodyEl, foot: footEl };
}

export function confirmDialog(message, { okLabel = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; m.close(); resolve(v); } };
    const m = modal({
      title: '確認',
      body: el('p', { text: message, style: 'margin:4px 0 8px' }),
      footer: [
        el('button', { class: 'btn', onclick: () => finish(false) }, 'キャンセル'),
        el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => finish(true) }, okLabel),
      ],
      onClose: () => finish(false),
    });
  });
}

/* ---------------- lightbox ---------------- */

export function lightbox(src) {
  const close = () => box.remove();
  const box = el('div', { class: 'lightbox', onclick: close },
    el('img', { src, alt: '' }),
    el('button', { class: 'x', 'aria-label': '閉じる' }, '✕')
  );
  document.body.append(box);
}

/* ---------------- フォーマット ---------------- */

export function formatDate(iso, { withTime = true } = {}) {
  if (!iso) return '日時不明';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '日時不明';
  const date = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

const pad = (n) => String(n).padStart(2, '0');

/** Date → <input type="datetime-local"> の値 */
export function toLocalInput(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** <input type="datetime-local"> の値 → ISO 文字列 */
export function fromLocalInput(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function formatSize(sizeMm) {
  if (!Array.isArray(sizeMm)) return '不明';
  const [min, max] = sizeMm;
  return min === max ? `約${max}mm` : `${min}〜${max}mm`;
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- Blob URL ---------------- */

// 同じ Blob に何度も createObjectURL しないよう記憶しておく。
// 写真インデックスを作り直すときに revokeCached() でまとめて解放する。
const urlCache = new Map();

export function blobUrlFor(blob) {
  if (!blob) return '';
  let u = urlCache.get(blob);
  if (!u) {
    u = URL.createObjectURL(blob);
    urlCache.set(blob, u);
  }
  return u;
}

export function revokeCached() {
  for (const u of urlCache.values()) URL.revokeObjectURL(u);
  urlCache.clear();
}

/* ---------------- カエルのシルエット（未観察のプレースホルダ） ---------------- */

export function silhouette() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 86');
  svg.setAttribute('aria-hidden', 'true');
  // 1本のパスで描く。塗り足す形は時計回り、穴にする形（瞳・鼻孔・口）は反時計回りにして、
  // nonzero 規則で穴が空くようにしている。
  //   ・頭は横に平たい楕円（カエルは頭が幅広い）
  //   ・目は頭の輪郭から上へ大きく突き出させる（クマの耳に見えないよう、頭頂ではなく上前方）
  //   ・口は顔幅いっぱいに広がる三日月
  svg.innerHTML = `<path fill="currentColor" d="
    M8 57a42 25 0 1 1 84 0 42 25 0 1 1-84 0Z
    M14 28a14 14 0 1 1 28 0 14 14 0 1 1-28 0Z
    M58 28a14 14 0 1 1 28 0 14 14 0 1 1-28 0Z
    M20.5 28a7.5 7.5 0 1 0 15 0 7.5 7.5 0 1 0-15 0Z
    M64.5 28a7.5 7.5 0 1 0 15 0 7.5 7.5 0 1 0-15 0Z
    M24.5 28a3.5 3.5 0 1 1 7 0 3.5 3.5 0 1 1-7 0Z
    M68.5 28a3.5 3.5 0 1 1 7 0 3.5 3.5 0 1 1-7 0Z
    M39.5 49a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0Z
    M55.5 49a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0Z
    M17 58Q50 85 83 58Q50 73.5 17 58Z
  "/>`;
  return svg;
}
