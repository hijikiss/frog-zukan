/** 起動・ルーティング・進捗表示 */

import * as sp from './species.js';
import { meta } from './db.js';
import { el, clear, toast, revokeCached } from './ui.js';
import * as listView from './views/list.js';
import * as detailView from './views/detail.js';
import * as facilitiesView from './views/facilities.js';
import * as settingsView from './views/settings.js';

const view = document.getElementById('view');
const appTitle = document.getElementById('appTitle');
const backBtn = document.getElementById('backBtn');
const progressText = document.getElementById('progressText');
const progressWild = document.getElementById('progressWild');
const progressCaptive = document.getElementById('progressCaptive');
const progressStrip = document.getElementById('progressStrip');

/* ---------------- テーマ ---------------- */

async function initTheme() {
  const saved = await meta.get('theme');
  applyTheme(saved || 'auto');

  document.getElementById('themeBtn').addEventListener('click', async () => {
    const cur = document.documentElement.dataset.theme || 'auto';
    const next = cur === 'dark' ? 'light' : cur === 'light' ? 'auto' : 'dark';
    applyTheme(next);
    await meta.set('theme', next);
    toast({ dark: 'ダークテーマ', light: 'ライトテーマ', auto: '端末の設定に従う' }[next]);
  });
}

function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'auto') {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.themeMode = 'auto';
  } else {
    root.dataset.theme = mode;
    root.dataset.themeMode = mode;
  }
  const color = root.dataset.theme === 'dark' ? '#1c4430' : '#2f6b46';
  document.querySelector('meta[name="theme-color"]').setAttribute('content', color);
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (document.documentElement.dataset.themeMode === 'auto') applyTheme('auto');
});

/* ---------------- 進捗 ---------------- */

function paintProgress() {
  const { total, observed, wild, captive } = sp.progress();
  progressText.innerHTML = '';
  progressText.append(
    `${total}種中 `,
    el('b', { text: String(observed) }),
    `種観察済み（うち野生 `,
    el('b', { text: String(wild) }),
    `種）`
  );
  const pct = (n) => (total ? (n / total) * 100 : 0);
  progressWild.style.width = `${pct(wild)}%`;
  progressCaptive.style.width = `${pct(captive)}%`;
  void observed;
}

/** 写真が増減したあとに呼ぶ：インデックス再構築 → 進捗更新 → 画面再描画 */
async function refresh() {
  revokeCached();
  await sp.refreshPhotoIndex();
  paintProgress();
  await route();
}

/* ---------------- ルーティング ---------------- */

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const parts = h.split('/').filter(Boolean);
  return { parts, raw: h };
}

async function route() {
  const { parts } = parseHash();
  const [head, arg] = parts;

  window.scrollTo({ top: 0 });
  setActiveTab(head === 'facilities' || head === 'f' ? 'facilities' : head === 'settings' ? 'settings' : 'list');

  try {
    if (head === 's' && arg) {
      const s = sp.get(decodeURIComponent(arg));
      setChrome(s ? s.nameJa : 'カエル図鑑', true, false);
      await detailView.render(view, decodeURIComponent(arg), { refresh });
    } else if (head === 'f' && arg) {
      const name = decodeURIComponent(arg);
      setChrome(name === '__wild__' ? '野外の観察' : name, true, false);
      await facilitiesView.renderOne(view, name);
    } else if (head === 'facilities') {
      setChrome('施設別', false, true);
      await facilitiesView.renderList(view);
    } else if (head === 'settings') {
      setChrome('設定', false, false);
      await settingsView.render(view, { refresh });
    } else {
      setChrome('カエル図鑑', false, true);
      listView.render(view);
    }
  } catch (err) {
    console.error(err);
    clear(view);
    view.append(el('div', { class: 'empty-state' },
      el('span', { class: 'big' }, '⚠️'),
      err.message || '表示できませんでした'));
  }
}

function setChrome(title, showBack, showProgress) {
  appTitle.textContent = title;
  backBtn.hidden = !showBack;
  progressStrip.style.display = showProgress ? '' : 'none';
}

function setActiveTab(name) {
  for (const t of document.querySelectorAll('.tab')) {
    t.classList.toggle('active', t.dataset.tab === name);
  }
}

backBtn.addEventListener('click', () => {
  if (history.length > 1) history.back();
  else location.hash = '#/';
});

window.addEventListener('hashchange', route);

/* ---------------- 起動 ---------------- */

async function main() {
  await initTheme();
  view.append(el('div', { class: 'spinner' }));

  try {
    await sp.load();
  } catch (err) {
    clear(view);
    view.append(el('div', { class: 'empty-state' },
      el('span', { class: 'big' }, '⚠️'),
      '種データを読み込めませんでした。',
      el('div', { class: 'hint', style: 'margin-top:8px', text: String(err.message || err) })));
    return;
  }

  paintProgress();
  await route();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* 失敗しても通常動作する */ });
    });
  }
}

main();
