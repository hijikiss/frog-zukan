/**
 * 記録タブ：サマリー（達成状況のダッシュボード）とライフリスト（初観察のタイムライン）。
 *
 * どちらも写真から毎回導出する（観察ステータスと同じ方針＝保存しないので不整合が起きない）。
 * 「初観察日」は、その種の写真のうち一番古い撮影日時。
 */

import * as sp from '../species.js';
import { GROUPS, group as groupOf, REDLIST } from '../groups.js';
import { photos as photoDb } from '../db.js';
import { silhouette } from '../icons.js';
import { el, clear, blobUrlFor, formatDate } from '../ui.js';

// タブを離れて戻ってきても、見ていた方を覚えておく
let tab = 'summary';

export async function render(view) {
  clear(view);
  const all = await photoDb.all();
  // 読み込んだ写真でインデックスを作り直す。集計（写真から直接）と
  // 達成数（photoIndex 経由）が食い違わないようにするため。読み込みは1回で済ませる。
  await sp.refreshPhotoIndex(all);
  const body = el('div');

  const segSummary = el('button', {
    type: 'button',
    'aria-pressed': String(tab === 'summary'),
    onclick: () => setTab('summary'),
  }, el('span', {}, '📊 サマリー'));

  const segLife = el('button', {
    type: 'button',
    'aria-pressed': String(tab === 'lifelist'),
    onclick: () => setTab('lifelist'),
  }, el('span', {}, '🗓 ライフリスト'));

  view.append(
    el('div', { class: 'segmented stats-seg', style: 'margin-bottom:12px' }, segSummary, segLife),
    body
  );

  paint();

  function setTab(v) {
    tab = v;
    segSummary.setAttribute('aria-pressed', String(v === 'summary'));
    segLife.setAttribute('aria-pressed', String(v === 'lifelist'));
    paint();
  }

  function paint() {
    clear(body);
    if (!all.length) {
      body.append(el('div', { class: 'empty-state' },
        el('span', { class: 'big' }, '📷'),
        'まだ観察の記録がありません。',
        el('div', { style: 'margin-top:6px;font-size:12px' },
          '種の画面から写真を登録すると、ここに記録がたまっていきます。')));
      return;
    }
    body.append(tab === 'summary' ? summary(all) : lifelist(all));
  }
}

/* ================= ⑤ サマリー ================= */

function summary(all) {
  const wrap = el('div');
  const total = sp.progress();
  const firsts = firstSeen(all);

  const days = new Set(all.map((p) => dateKey(p)).filter(Boolean));
  const facilities = new Set(all.filter((p) => p.context === 'captive' && p.facility).map((p) => p.facility));
  const places = new Set(all.filter((p) => p.context === 'wild' && p.placeName).map((p) => p.placeName));

  /* --- 全体の達成率 --- */
  const pct = total.total ? Math.round((total.observed / total.total) * 1000) / 10 : 0;
  wrap.append(
    el('div', { class: 'panel stat-hero' },
      el('div', { class: 'stat-hero-num' },
        el('b', { text: String(total.observed) }),
        el('span', { text: ` / ${total.total}種` })),
      el('div', { class: 'stat-hero-sub', text: `図鑑の ${pct}% を観察しました` }),
      bar(total.total, total.wild, total.captive),
      el('div', { class: 'stat-legend' },
        el('span', {}, el('i', { class: 'dot wild' }), `野生 ${total.wild}種`),
        el('span', {}, el('i', { class: 'dot captive' }), `展示 ${total.captive}種`))
    )
  );

  /* --- 数字のタイル --- */
  wrap.append(
    el('div', { class: 'stat-grid' },
      tile('📷', String(all.length), '枚の写真'),
      tile('🗓', String(days.size), '日の観察'),
      tile('🏛', String(facilities.size), 'か所の施設'),
      tile('🌿', String(places.size), 'か所の野外')
    )
  );

  /* --- グループ別 --- */
  wrap.append(el('div', { class: 'section-title', text: 'グループ別' }));
  const rows = el('div', { class: 'list-rows' });
  const ordered = GROUPS
    .map((g) => ({ g, p: sp.progress(g.id) }))
    .sort((a, b) => (b.p.observed / (b.p.total || 1)) - (a.p.observed / (a.p.total || 1)));
  for (const { g, p } of ordered) {
    rows.append(
      el('a', { class: 'row', href: `#/g/${g.id}` },
        el('span', { class: 'ico stat-ico' }, silhouette(g.id)),
        el('span', { class: 'main' },
          el('span', { class: 't', text: g.name }),
          el('span', { class: 's', text: `${p.observed} / ${p.total}種（野生 ${p.wild}）` }),
          bar(p.total, p.wild, p.captive)
        ),
        el('span', { class: 'chev' }, '›')
      )
    );
  }
  wrap.append(rows);

  /* --- 観察した中で保全上めずらしい種 --- */
  const rare = observedSpecies(firsts)
    .filter((s) => REDLIST.indexOf(s.tags.redlist) <= REDLIST.indexOf('絶滅危惧II類(VU)'))
    .sort((a, b) => REDLIST.indexOf(a.tags.redlist) - REDLIST.indexOf(b.tags.redlist))
    .slice(0, 12);
  if (rare.length) {
    wrap.append(el('div', { class: 'section-title', text: '観察した希少な種' }));
    const rareRows = el('div', { class: 'list-rows' });
    for (const s of rare) {
      rareRows.append(
        el('a', { class: 'row', href: `#/s/${encodeURIComponent(s.id)}` },
          thumbOf(s),
          el('span', { class: 'main' },
            el('span', { class: 't', text: s.nameJa }),
            el('span', { class: 's', text: `${s.tags.redlist} ・ ${groupOf(s.group).name}` })
          ),
          el('span', { class: 'chev' }, '›')
        )
      );
    }
    wrap.append(rareRows);
  }

  /* --- 最近の初観察 --- */
  const recent = [...firsts.values()].sort((a, b) => (b.first || '').localeCompare(a.first || '')).slice(0, 6);
  if (recent.length) {
    wrap.append(el('div', { class: 'section-title', text: '最近はじめて見た種' }));
    const grid = el('div', { class: 'grid' });
    for (const e of recent) {
      const s = sp.get(e.id);
      if (s) grid.append(lifeCard(s, e));
    }
    wrap.append(grid);
  }

  return wrap;
}

const tile = (ico, num, label) =>
  el('div', { class: 'stat-tile' },
    el('span', { class: 'stat-tile-ico', text: ico }),
    el('b', { text: num }),
    el('span', { class: 'stat-tile-label', text: label }));

function bar(total, wild, captive) {
  const pct = (n) => (total ? (n / total) * 100 : 0);
  return el('div', { class: 'browse-bar', 'aria-hidden': 'true' },
    el('div', { class: 'browse-fill wild', style: `width:${pct(wild)}%` }),
    el('div', { class: 'browse-fill captive', style: `width:${pct(captive)}%` }));
}

/* ================= ④ ライフリスト ================= */

function lifelist(all) {
  const wrap = el('div');
  const entries = [...firstSeen(all).values()]
    .filter((e) => sp.get(e.id))
    .sort((a, b) => (b.first || '').localeCompare(a.first || ''));

  if (!entries.length) {
    wrap.append(el('div', { class: 'empty-state' },
      el('span', { class: 'big' }, '🗓'), '記録がまだありません。'));
    return wrap;
  }

  const newest = entries[0].first;
  const oldest = entries[entries.length - 1].first;
  wrap.append(
    el('p', { class: 'browse-lead' },
      `はじめて見た順に ${entries.length}種。`,
      oldest ? ` （${formatDate(oldest, { withTime: false })} 〜 ${formatDate(newest, { withTime: false })}）` : '')
  );

  // 年月ごとにまとめる
  let currentMonth = null;
  let grid = null;
  for (const e of entries) {
    const month = (e.first || '').slice(0, 7);
    if (month !== currentMonth) {
      currentMonth = month;
      const count = entries.filter((x) => (x.first || '').slice(0, 7) === month).length;
      wrap.append(el('div', { class: 'timeline-head' },
        el('span', { class: 'timeline-month', text: monthLabel(month) }),
        el('span', { class: 'timeline-count', text: `${count}種` })));
      grid = el('div', { class: 'grid' });
      wrap.append(grid);
    }
    const s = sp.get(e.id);
    if (s) grid.append(lifeCard(s, e));
  }

  return wrap;
}

/** ライフリスト用のカード。初観察日と、そのとき野生だったかを出す。 */
function lifeCard(s, e) {
  const info = sp.photoInfo(s.id);
  const imgBox = el('div', { class: 'card-img' + (info?.cover ? '' : ' empty') });
  if (info?.cover) imgBox.append(el('img', { src: blobUrlFor(info.cover), alt: s.nameJa, loading: 'lazy' }));
  else imgBox.append(silhouette(s.group));
  if (e.firstWild) imgBox.append(el('span', { class: 'badge wild', text: '野生' }));

  return el('a', { class: 'card', href: `#/s/${encodeURIComponent(s.id)}` },
    imgBox,
    el('div', { class: 'card-body' },
      el('p', { class: 'card-ja', text: s.nameJa }),
      el('p', { class: 'card-date', text: formatDate(e.first, { withTime: false }) })
    )
  );
}

/* ================= 共通の集計 ================= */

/** 種ごとの初観察（一番古い写真の日時）。Map<speciesId, {id, first, firstWild}> */
function firstSeen(all) {
  const m = new Map();
  for (const p of all) {
    const t = p.takenAt || p.createdAt || '';
    let e = m.get(p.speciesId);
    if (!e) {
      e = { id: p.speciesId, first: t, firstWild: null };
      m.set(p.speciesId, e);
    }
    if (t && (!e.first || t < e.first)) e.first = t;
    if (p.context === 'wild' && t && (!e.firstWild || t < e.firstWild)) e.firstWild = t;
  }
  return m;
}

const observedSpecies = (firsts) => [...firsts.keys()].map((id) => sp.get(id)).filter(Boolean);

const dateKey = (p) => (p.takenAt || p.createdAt || '').slice(0, 10);

function monthLabel(month) {
  const [y, m] = month.split('-');
  return y && m ? `${y}年${Number(m)}月` : '日付なし';
}

function thumbOf(s) {
  const info = sp.photoInfo(s.id);
  const box = el('span', { class: 'ico stat-thumb' });
  if (info?.cover) box.append(el('img', { src: blobUrlFor(info.cover), alt: '', loading: 'lazy' }));
  else box.append(silhouette(s.group));
  return box;
}
