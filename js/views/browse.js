/**
 * 階層をたどる画面。
 *   レベル1: グループ（科の上のまとまり）の一覧   renderSubgroups
 *   レベル2: そのグループに含まれる科の一覧        renderFamilies
 * どちらもタップで1段ずつ絞り込み、最後は list.js（科でしぼった種一覧）へ。
 * 上部の検索窓に打つと、階層に代えてそのグループの種を名前で検索した結果を出す。
 */

import * as sp from '../species.js';
import { group as groupOf } from '../groups.js';
import { silhouette } from '../icons.js';
import { el, clear } from '../ui.js';
import { speciesCard } from './card.js';

// 検索文字はグループごとに覚えておく（レベル1/2で同じ窓を共有）
const searchStates = new Map();

/* ---- レベル1：グループ一覧 ---- */
export function renderSubgroups(view, groupId) {
  renderBrowse(view, groupId, (body) => {
    const g = groupOf(groupId);
    const list = el('div', { class: 'browse-list' });
    for (const sg of sp.subgroups(groupId)) {
      list.append(row({
        href: `#/g/${g.id}/sg/${sg.key}`,
        group: g.id,
        title: sg.name,
        sub: `${sp.families(g.id, sg.key).length}科`,
        total: sg.total, observed: sg.observed, wild: sg.wild,
      }));
    }
    body.append(
      el('p', { class: 'browse-lead', text: 'グループを選ぶか、上の検索で名前から探せます。' }),
      list,
      el('a', { class: 'browse-all', href: `#/g/${g.id}/all` },
        el('span', { class: 'ico' }, '🎛'),
        `タグ（大きさ・毒・分布など）で絞り込む`)
    );
  });
}

/* ---- レベル2：科一覧 ---- */
export function renderFamilies(view, groupId, subgroupKey) {
  renderBrowse(view, groupId, (body) => {
    const g = groupOf(groupId);
    const fams = sp.families(groupId, subgroupKey);
    if (!fams.length) {
      body.append(el('div', { class: 'empty-state' },
        el('span', { class: 'big' }, '🚧'), 'このグループの科はまだありません。'));
      return;
    }
    const list = el('div', { class: 'browse-list' });
    for (const f of fams) {
      list.append(row({
        href: `#/g/${g.id}/fam/${encodeURIComponent(f.name)}`,
        group: g.id,
        title: f.name,
        sub: f.familySci,
        total: f.count, observed: f.observed, wild: f.wild,
      }));
    }
    body.append(list);
  });
}

/* ---- 検索窓つきの枠（本体は buildHierarchy が埋める） ---- */
function renderBrowse(view, groupId, buildHierarchy) {
  const g = groupOf(groupId);
  clear(view);
  const body = el('div');

  const input = el('input', {
    type: 'search',
    placeholder: `${g.name}を名前で検索`,
    value: searchStates.get(g.id) || '',
    enterkeyhint: 'search',
    oninput: (e) => { searchStates.set(g.id, e.target.value); paint(); },
  });

  view.append(
    el('div', { class: 'searchrow' },
      el('div', { class: 'search' },
        input,
        el('button', {
          class: 'clear',
          'aria-label': '検索をクリア',
          onclick: () => { searchStates.set(g.id, ''); input.value = ''; paint(); },
        }, '✕')
      )
    ),
    body
  );
  paint();

  function paint() {
    clear(body);
    const q = (searchStates.get(g.id) || '').trim();
    if (q) body.append(searchResults(g.id, q));
    else buildHierarchy(body);
  }
}

/* ---- グループ内を名前で検索した結果グリッド ---- */
function searchResults(groupId, q) {
  const list = sp.sort(sp.search(sp.all(groupId), q), 'taxonomy');
  const wrap = el('div');
  wrap.append(el('div', { class: 'result-count', style: 'margin:2px 4px 8px', text: `${list.length}種を表示` }));
  if (!list.length) {
    wrap.append(el('div', { class: 'empty-state' },
      el('span', { class: 'big' }, '🔎'), '名前に合う種が見つかりませんでした。'));
    return wrap;
  }
  const grid = el('div', { class: 'grid' });
  for (const s of list) grid.append(speciesCard(s));
  wrap.append(grid);
  return wrap;
}

/* ---- 共通の1行（アイコン・名前・種数・観察バー） ---- */
function row({ href, group, title, sub, total, observed, wild }) {
  const pct = (n) => (total ? (n / total) * 100 : 0);
  return el('a', { class: 'browse-row', href },
    el('div', { class: 'browse-ico' }, silhouette(group)),
    el('div', { class: 'browse-main' },
      el('div', { class: 'browse-name', text: title }),
      sub ? el('div', { class: 'browse-sub', text: sub }) : null,
      el('div', { class: 'browse-bar', 'aria-hidden': 'true' },
        el('div', { class: 'browse-fill wild', style: `width:${pct(wild)}%` }),
        el('div', { class: 'browse-fill captive', style: `width:${pct(observed - wild)}%` })
      )
    ),
    el('div', { class: 'browse-count' },
      el('b', { text: String(observed) }), ` / ${total}`),
    el('span', { class: 'browse-chev', 'aria-hidden': 'true', text: '›' })
  );
}
