/** 詳細画面：種情報 + 写真ギャラリー */

import * as sp from '../species.js';
import { group as groupOf } from '../groups.js';
import { photos as photoDb } from '../db.js';
import * as photoEditor from './photo-editor.js';
import * as speciesEditor from './species-editor.js';
import {
  el, clear, silhouette, blobUrlFor, lightbox, toast,
  formatDate, formatSize,
} from '../ui.js';

export async function render(view, id, { refresh }) {
  const s = sp.get(id);
  clear(view);

  if (!s) {
    view.append(el('div', { class: 'empty-state' },
      el('span', { class: 'big' }, '🐸'), 'この種は見つかりませんでした。'));
    return;
  }

  const list = (await photoDb.bySpecies(id)).sort(sortPhotos);
  const status = sp.statusOf(id);

  /* ---- ヒーロー画像 ---- */
  // 手動で選んだメイン写真があれば最優先。無ければ野生＞展示＞新しい順（カードと同じ規則）。
  const cover = list.find((p) => p.cover) || list.find((p) => p.context === 'wild') || list[0];
  const coverId = cover?.id;
  const hero = el('div', { class: 'hero' + (cover ? '' : ' empty') });
  if (cover) {
    // ヒーローはトリミング済みサムネ（生き物を枠の中心に据えた正方形）を表示し、
    // タップ時のライトボックスでは元画像（全体）を見せる。
    hero.append(el('img', {
      src: blobUrlFor(cover.thumb || cover.blob),
      alt: s.nameJa,
      onclick: () => lightbox(blobUrlFor(cover.blob)),
    }));
  } else {
    hero.append(silhouette(s.group));
  }

  /* ---- 種情報 ---- */
  const g = groupOf(s.group);
  const t = s.tags;
  const facts = el('dl', { class: 'facts' },
    row('グループ', `${g.name}（${g.taxon}）`),
    rowNode('科', el('a', {
      class: 'facts-link',
      href: `#/g/${s.group}/fam/${encodeURIComponent(s.family)}`,
    }, `${s.family}${s.familySci ? `（${s.familySci}）` : ''}`)),
    row(g.lengthLabel, formatSize(s.sizeMm)),
    row('生息環境', t.habitat.join('・') || '不明'),
    row('活動時間', t.activity.join('・') || '不明'),
    row('分布', t.region.join('・') || '不明'),
    row(g.breedingLabel, t.breeding || '不明'),
    row('保全状況', t.redlist || '不明')
  );

  const tags = el('div', { class: 'taglist' },
    t.habitat.map((h) => el('span', { class: 'tag', text: h })),
    el('span', { class: 'tag' + (t.origin === '外来' ? ' alien' : ''), text: t.origin }),
    t.size ? el('span', { class: 'tag', text: t.size }) : null,
    t.activity.map((a) => el('span', { class: 'tag', text: a })),
    t.toxic && g.toxic.show ? el('span', { class: 'tag toxic', text: g.toxic.label }) : null,
    s.zooDisplay ? el('span', { class: 'tag', text: '展示個体が多い' }) : null,
    el('span', { class: 'tag rl', text: t.redlist })
  );

  const info = el('div', { class: 'panel' },
    el('h2', { text: s.nameJa }),
    el('p', { class: 'sci', text: s.nameSci }),
    s.nameEn ? el('p', { class: 'en', text: s.nameEn }) : null,
    s.aliases?.length
      ? el('p', { class: 'aliases', text: `別名: ${s.aliases.join('、')}` })
      : null,
    tags,
    facts,
    s.description ? el('p', { class: 'desc', text: s.description }) : null,
    el('div', { class: 'statusline' },
      el('span', { class: `dot ${status}` }),
      sp.STATUS_LABEL[status],
      list.length
        ? el('span', { style: 'color:var(--text-dim);font-weight:400', text: `　写真 ${list.length}枚` })
        : null,
      el('span', { style: 'flex:1' }),
      el('button', {
        class: 'btn sm',
        onclick: () => speciesEditor.open({ species: s, onSaved: refresh }),
      }, '情報を編集')
    ),
    sp.isEdited(id) || sp.isCustom(id)
      ? el('div', { class: 'hint', style: 'margin-top:8px;font-size:11.5px;color:var(--text-dim)',
                    text: sp.isCustom(id) ? '※ 自分で追加した種です' : '※ この種の情報は自分で編集しています' })
      : null
  );

  /* ---- 写真ギャラリー ---- */
  const galleryPanel = el('div', { class: 'panel' },
    el('div', { class: 'section-head' },
      el('h3', {}, `写真（${list.length}）`),
      el('button', { class: 'btn sm primary', onclick: pick }, '＋ 追加')
    ),
    list.length
      ? el('div', { class: 'gallery' }, list.map(photoCard))
      : el('div', { class: 'empty-state', style: 'padding:22px 8px' },
          el('span', { class: 'big' }, '📷'),
          'まだ写真がありません。',
          el('div', { style: 'margin-top:6px;font-size:12px' }, '観察したら写真を追加しましょう。'))
  );

  const fileInput = el('input', {
    type: 'file',
    accept: 'image/*',
    multiple: true,
    style: 'display:none',
    onchange: async (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      for (const f of files) {
        await photoEditor.open({ speciesId: id, file: f, onSaved: refresh });
      }
    },
  });

  view.append(hero, info, galleryPanel, fileInput);
  view.append(el('button', { class: 'fab', onclick: pick }, '📷 写真を追加'));

  function pick() {
    fileInput.click();
  }

  function photoCard(p) {
    const where = p.context === 'captive'
      ? (p.facility || '施設名なし')
      : (p.placeName || (p.lat != null ? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : '場所なし'));

    return el('button', {
      class: 'photo-card',
      onclick: () => photoEditor.edit(p.id, refresh),
    },
      el('div', { class: 'ph' },
        el('img', { src: blobUrlFor(p.thumb || p.blob), alt: '', loading: 'lazy' }),
        el('span', { class: `pill ${p.context}`, text: p.context === 'wild' ? '野生' : '展示' }),
        p.id === coverId && list.length > 1
          ? el('span', { class: 'pill cover', text: '★ メイン' }) : null
      ),
      el('div', { class: 'photo-meta' },
        el('span', { class: 'where', text: where }),
        el('span', { class: 'when', text: formatDate(p.takenAt, { withTime: false }) }),
        p.note ? el('div', { class: 'note', text: p.note }) : null
      )
    );
  }
}

const row = (k, v) => [el('dt', { text: k }), el('dd', { text: v })];
const rowNode = (k, node) => [el('dt', { text: k }), el('dd', {}, node)];

function sortPhotos(a, b) {
  // 野生を先に、同条件なら新しい撮影日順
  if ((a.context === 'wild') !== (b.context === 'wild')) return a.context === 'wild' ? -1 : 1;
  return (b.takenAt || b.createdAt || '').localeCompare(a.takenAt || a.createdAt || '');
}

void toast;
