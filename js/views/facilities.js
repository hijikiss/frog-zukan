/** 施設別ページ：施設一覧 → その施設で観察した種 */

import * as sp from '../species.js';
import * as photoStore from '../photos.js';
import { photos as photoDb } from '../db.js';
import { el, clear, blobUrlFor, silhouette, formatDate } from '../ui.js';

/* ---------------- 施設一覧 ---------------- */

export async function renderList(view) {
  clear(view);
  const list = await photoStore.facilitySummary();

  const wildCount = await wildSpeciesCount();

  if (!list.length && !wildCount) {
    view.append(el('div', { class: 'empty-state' },
      el('span', { class: 'big' }, '🏛'),
      '施設での観察記録がまだありません。',
      el('div', { style: 'margin-top:6px;font-size:12px' },
        '写真を「飼育展示」で登録すると、施設ごとにまとまります。')
    ));
    return;
  }

  if (list.length) {
    view.append(el('div', { class: 'section-title', text: `飼育展示（${list.length}施設）` }));
    view.append(
      el('div', { class: 'list-rows' },
        list.map((f) =>
          el('a', { class: 'row', href: `#/f/${encodeURIComponent(f.name)}` },
            el('span', { class: 'ico' }, '🏛'),
            el('span', { class: 'main' },
              el('span', { class: 't', text: f.name }),
              el('span', { class: 's', text: `${f.speciesCount}種 ・ 写真${f.photoCount}枚 ・ 最終 ${formatDate(f.lastVisit, { withTime: false })}` })
            ),
            el('span', { class: 'chev' }, '›')
          )
        )
      )
    );
  }

  if (wildCount) {
    view.append(el('div', { class: 'section-title', text: 'フィールド' }));
    view.append(
      el('div', { class: 'list-rows' },
        el('a', { class: 'row', href: '#/f/__wild__' },
          el('span', { class: 'ico' }, '🌿'),
          el('span', { class: 'main' },
            el('span', { class: 't', text: '野外で観察した生き物' }),
            el('span', { class: 's', text: `${wildCount}種` })
          ),
          el('span', { class: 'chev' }, '›')
        )
      )
    );
  }
}

async function wildSpeciesCount() {
  const all = await photoDb.all();
  return new Set(all.filter((p) => p.context === 'wild').map((p) => p.speciesId)).size;
}

/* ---------------- 施設詳細 ---------------- */

export async function renderOne(view, name) {
  clear(view);

  const isWild = name === '__wild__';
  const all = await photoDb.all();
  const list = isWild
    ? all.filter((p) => p.context === 'wild')
    : all.filter((p) => p.context === 'captive' && p.facility === name);

  if (!list.length) {
    view.append(el('div', { class: 'empty-state' },
      el('span', { class: 'big' }, '🐸'), 'ここでの観察記録はありません。'));
    return;
  }

  // 種ごとにまとめる
  const bySpecies = new Map();
  for (const p of list) {
    if (!bySpecies.has(p.speciesId)) bySpecies.set(p.speciesId, []);
    bySpecies.get(p.speciesId).push(p);
  }

  const visits = [...new Set(list.map((p) => (p.takenAt || p.createdAt || '').slice(0, 10)).filter(Boolean))].sort();
  const places = isWild
    ? [...new Set(list.map((p) => p.placeName).filter(Boolean))]
    : [];

  view.append(
    el('div', { class: 'panel' },
      el('h2', { text: isWild ? '野外で観察した生き物' : name }),
      el('p', { class: 'en', text: `${bySpecies.size}種 ・ 写真 ${list.length}枚` }),
      visits.length
        ? el('div', { class: 'facts', style: 'margin-top:10px' },
            [el('dt', { text: isWild ? '観察日' : '訪問日' }),
             el('dd', { text: visits.length > 3
               ? `${visits.length}日（最新 ${visits[visits.length - 1].replace(/-/g, '/')}）`
               : visits.map((v) => v.replace(/-/g, '/')).join('、') })],
            places.length
              ? [el('dt', { text: '場所' }), el('dd', { text: places.join('、') })]
              : []
          )
        : null
    )
  );

  const grid = el('div', { class: 'grid' });
  const entries = [...bySpecies.entries()]
    .map(([id, ps]) => ({ species: sp.get(id), ps }))
    .filter((e) => e.species)
    .sort((a, b) => (a.species.family || '').localeCompare(b.species.family || '', 'ja')
      || a.species.nameJa.localeCompare(b.species.nameJa, 'ja'));

  for (const { species, ps } of entries) {
    const cover = ps[0];
    const imgBox = el('div', { class: 'card-img' + (cover ? '' : ' empty') });
    if (cover) imgBox.append(el('img', { src: blobUrlFor(cover.thumb || cover.blob), alt: '', loading: 'lazy' }));
    else imgBox.append(silhouette(species.group));
    if (ps.length > 1) imgBox.append(el('span', { class: 'badge-count', text: `${ps.length}枚` }));

    grid.append(
      el('a', { class: 'card', href: `#/s/${encodeURIComponent(species.id)}` },
        imgBox,
        el('div', { class: 'card-body' },
          el('p', { class: 'card-ja', text: species.nameJa }),
          el('p', { class: 'card-sci', text: species.nameSci })
        )
      )
    );
  }

  view.append(grid);
}
