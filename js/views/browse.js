/**
 * 階層をたどる画面。
 *   レベル1: グループ（科の上のまとまり）の一覧   renderSubgroups
 *   レベル2: そのグループに含まれる科の一覧        renderFamilies
 * どちらもタップで1段ずつ絞り込み、最後は list.js（科でしぼった種一覧）へ。
 */

import * as sp from '../species.js';
import { group as groupOf } from '../groups.js';
import { silhouette } from '../icons.js';
import { el, clear } from '../ui.js';

/* ---- レベル1：グループ一覧 ---- */
export function renderSubgroups(view, groupId) {
  const g = groupOf(groupId);
  clear(view);

  const rows = sp.subgroups(groupId);
  const list = el('div', { class: 'browse-list' });
  for (const sg of rows) {
    list.append(row({
      href: `#/g/${g.id}/sg/${sg.key}`,
      group: g.id,
      title: sg.name,
      sub: `${familyCount(g.id, sg.key)}科`,
      total: sg.total, observed: sg.observed, wild: sg.wild,
    }));
  }

  view.append(
    el('p', { class: 'browse-lead', text: 'グループを選んでください。' }),
    list,
    el('a', { class: 'browse-all', href: `#/g/${g.id}/all` },
      el('span', { class: 'ico' }, '🔎'),
      `検索・絞り込みで${g.name}すべてから探す`)
  );
}

/* ---- レベル2：科一覧 ---- */
export function renderFamilies(view, groupId, subgroupKey) {
  const g = groupOf(groupId);
  clear(view);

  const fams = sp.families(groupId, subgroupKey);
  if (!fams.length) {
    view.append(el('div', { class: 'empty-state' },
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
  view.append(list);
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

function familyCount(groupId, subgroupKey) {
  return sp.families(groupId, subgroupKey).length;
}
