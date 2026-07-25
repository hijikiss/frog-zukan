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

  const vv = window.visualViewport;

  // スマホのソフトキーボードが出ると表示領域（visualViewport）が縮む。
  // そのときだけ背景を「実際に見えている領域」に合わせ、下端のフッター（登録ボタン）が
  // キーボードに隠れて押せなくなるのを防ぐ。
  //
  // 縮み量だけで判断してはいけない: iOS では写真の選択シートが閉じた直後などに
  // visualViewport が一時的に小さい値を返すことがあり、それを掴むとモーダルが
  // 画面の半分ほどの高さで固まってしまう（本文がほとんど見えなくなる）。
  // 入力中かどうかを条件に加えて、キーボード以外の理由では縮めない。
  const KEYBOARD_MIN_SHRINK = 100;

  const isTyping = () => {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
  };

  const fit = () => {
    if (!vv) return;
    if (isTyping() && window.innerHeight - vv.height > KEYBOARD_MIN_SHRINK) {
      backdrop.style.height = `${vv.height}px`;
      backdrop.style.top = `${vv.offsetTop}px`;
      backdrop.style.bottom = 'auto';
    } else {
      // CSS の 100dvh に戻す
      backdrop.style.height = '';
      backdrop.style.top = '';
      backdrop.style.bottom = '';
    }
  };

  const close = () => {
    if (vv) {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
    }
    document.removeEventListener('focusin', fit);
    document.removeEventListener('focusout', fit);
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

  // 入力欄への出入り（＝キーボードの開閉）でも測り直す
  document.addEventListener('focusin', fit);
  document.addEventListener('focusout', fit);

  if (vv) {
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    fit();
  }

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

/** 体長の表示。1m を超えるものはメートル表記にする（ヘビ・ワニ・ウミガメ用） */
export function formatSize(sizeMm) {
  if (!Array.isArray(sizeMm)) return '不明';
  const [min, max] = sizeMm;
  if (max >= 1000) {
    const m = (v) => `${Math.round(v / 10) / 100}m`.replace('.00m', 'm');
    return min === max ? `約${m(max)}` : `${m(min)}〜${m(max)}`;
  }
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

/* ---------------- シルエット（未観察のプレースホルダ） ---------------- */

// 実体は js/icons.js（グループごとに絵が違う）。従来どおり ui.js からも使えるようにしておく。
export { silhouette } from './icons.js';
