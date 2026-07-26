/** 種カード（グリッドの1枚）。一覧・階層検索・横断検索で共通して使う。 */

import * as sp from '../species.js';
import { group as groupOf } from '../groups.js';
import { el, blobUrlFor, silhouette } from '../ui.js';

/**
 * @param opts.onNavigate クリック直前に呼ぶ（スクロール位置の保存など）
 * @param opts.showGroup  どのグループの種かをバッジで示す（横断検索の結果用）
 */
export function speciesCard(s, opts = {}) {
  const status = sp.statusOf(s.id);
  const info = sp.photoInfo(s.id);

  const imgBox = el('div', { class: 'card-img' + (info?.cover ? '' : ' empty') });
  if (info?.cover) {
    imgBox.append(el('img', { src: blobUrlFor(info.cover), alt: s.nameJa, loading: 'lazy' }));
  } else {
    imgBox.append(silhouette(s.group));
  }

  if (status !== 'unseen') {
    imgBox.append(el('span', { class: `badge ${status}`, text: status === 'wild' ? '野生' : '展示' }));
  }
  if (info && info.count > 1) {
    imgBox.append(el('span', { class: 'badge-count', text: `${info.count}枚` }));
  }

  return el('a', {
    class: 'card' + (status === 'unseen' ? ' unseen' : ''),
    href: `#/s/${encodeURIComponent(s.id)}`,
    onclick: opts.onNavigate || null,
  },
    imgBox,
    el('div', { class: 'card-body' },
      opts.showGroup ? el('span', { class: 'card-group', text: groupOf(s.group).name }) : null,
      el('p', { class: 'card-ja', text: s.nameJa }),
      el('p', { class: 'card-sci', text: s.nameSci })
    )
  );
}
