/** 起動・ルーティング・進捗表示 */

import * as sp from './species.js';
import { group as groupOf, isGroup, hasSubgroups, subgroupName, subgroupOfFamily } from './groups.js';
import { lockPageZoom } from './gestures.js';
import { meta } from './db.js';
import { el, clear, toast, revokeCached, updateBar } from './ui.js';
import * as homeView from './views/home.js';
import * as listView from './views/list.js';
import * as browseView from './views/browse.js';
import * as detailView from './views/detail.js';
import * as facilitiesView from './views/facilities.js';
import * as statsView from './views/stats.js';
import * as unidentifiedView from './views/unidentified.js';
import * as settingsView from './views/settings.js';

const APP_TITLE = '爬虫類・両生類図鑑';

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

/** 種リストを渡すとその範囲の進捗、省略で全グループ合計 */
function paintProgress(list) {
  const { total, observed, wild, captive } = sp.progressFor(list || sp.all());
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
  setActiveTab(
    head === 'facilities' || head === 'f' ? 'facilities'
      : head === 'stats' ? 'stats'
        : head === 'settings' ? 'settings'
          : 'list'
  );

  try {
    if (head === 's' && arg) {
      const id = decodeURIComponent(arg);
      const s = sp.get(id);
      setChrome(s ? s.nameJa : APP_TITLE, true, false);
      await detailView.render(view, id, { refresh });
    } else if (head === 'g' && arg && isGroup(arg)) {
      const g = groupOf(arg);
      const [, , seg2, seg3] = parts;
      if (seg2 === 'sg' && seg3) {
        // レベル2：そのグループ（科の上のまとまり）に含まれる科の一覧
        const list = sp.all(g.id).filter((s) => subgroupOfFamily(g.id, s.family) === seg3);
        setChrome(subgroupName(g.id, seg3), true, true, list);
        browseView.renderFamilies(view, g.id, seg3);
      } else if (seg2 === 'fam' && seg3) {
        // レベル3：科でしぼった種の一覧
        const family = decodeURIComponent(seg3);
        setChrome(family, true, true, sp.all(g.id).filter((s) => s.family === family));
        listView.render(view, g.id, { family });
      } else if (seg2 === 'all' || !hasSubgroups(g.id)) {
        // 階層を使わない（他グループ）か、明示的に「タグで絞り込む」を選んだとき
        setChrome(g.name, true, true, sp.all(g.id));
        listView.render(view, g.id);
      } else {
        // レベル1：グループ（科の上のまとまり）の一覧
        setChrome(g.name, true, true, sp.all(g.id));
        browseView.renderSubgroups(view, g.id);
      }
    } else if (head === 'f' && arg) {
      const name = decodeURIComponent(arg);
      setChrome(name === '__wild__' ? '野外の観察' : name, true, false);
      await facilitiesView.renderOne(view, name);
    } else if (head === 'facilities') {
      setChrome('施設別', false, true);
      await facilitiesView.renderList(view);
    } else if (head === 'stats') {
      setChrome('記録', false, true);
      await statsView.render(view);
      paintProgress();   // 記録画面が写真インデックスを作り直すので、ヘッダーも数え直す
    } else if (head === 'unidentified') {
      setChrome('未同定の写真', true, false);
      await unidentifiedView.render(view, { refresh });
    } else if (head === 'settings') {
      setChrome('設定', false, false);
      await settingsView.render(view, { refresh });
    } else {
      setChrome(APP_TITLE, false, true);
      await homeView.render(view, { refresh });
    }
  } catch (err) {
    console.error(err);
    clear(view);
    view.append(el('div', { class: 'empty-state' },
      el('span', { class: 'big' }, '⚠️'),
      err.message || '表示できませんでした'));
  }
}

function setChrome(title, showBack, showProgress, progressList) {
  appTitle.textContent = title;
  backBtn.hidden = !showBack;
  progressStrip.style.display = showProgress ? '' : 'none';
  if (showProgress) paintProgress(progressList);
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
  // 画面は固定。拡大縮小は写真（トリミング・拡大表示）の中だけで効かせる。
  lockPageZoom();

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

  initServiceWorker();
}

/* ---------------- 更新の検知 ---------------- */

/**
 * 新しい版が用意できたら教える。
 *
 * sw.js は install しても待機したままにしてある（画面が新旧まざったコードで動かないように）。
 * ここで待機中の版を見つけたらバーを出し、「更新」を押されたら skip-waiting を送って
 * 切り替え完了（controllerchange）で1度だけ再読み込みする。
 */
function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;   // 再読み込みは1回だけ（ループ防止）
    reloading = true;
    location.reload();
  });

  // 起動処理（種データの読み込み）を待つ間に load は済んでしまうので、
  // 「まだなら待つ、済んでいればすぐ」の両方を面倒みる。
  // ここを load 待ちだけにすると登録自体が走らず、オフラインで動かなくなる。
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });

  async function register() {
    let reg;
    try {
      reg = await navigator.serviceWorker.register('./sw.js');
    } catch {
      return;   // 登録できなくてもアプリ自体は動く
    }

    const notify = () => {
      // controller が無いのは初回インストール。まだ「更新」ではないので黙っておく。
      if (!navigator.serviceWorker.controller) return;
      updateBar(() => reg.waiting?.postMessage('skip-waiting'));
    };

    if (reg.waiting) notify();
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed') notify();
      });
    });

    // ホーム画面から使うと画面を開きっぱなしにしがちなので、
    // 戻ってきたタイミングで新しい版が出ていないか確かめる。
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => { /* 圏外など */ });
    });
  }
}

main();
