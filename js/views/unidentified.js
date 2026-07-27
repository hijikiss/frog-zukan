/**
 * 未同定の写真の一覧。
 * 「撮ったけど名前が分からない」写真を置いておき、分かったときに種へ結びつける。
 */

import * as sp from '../species.js';
import * as photoStore from '../photos.js';
import * as photoEditor from './photo-editor.js';
import { pickSpecies } from './species-picker.js';
import { el, clear, blobUrlFor, formatDate, toast, canShareImage, shareImage } from '../ui.js';

export async function render(view, { refresh }) {
  clear(view);
  const list = await photoStore.unidentified();

  if (!list.length) {
    view.append(el('div', { class: 'empty-state' },
      el('span', { class: 'big' }, '🔍'),
      '未同定の写真はありません。',
      el('div', { style: 'margin-top:6px;font-size:12px' },
        '名前が分からない生き物は「あとで同定する」で登録しておけます。')));
    return;
  }

  view.append(
    el('p', { class: 'browse-lead', text: `${list.length}枚の写真の名前がまだ決まっていません。写真をタップして種を選べます。` })
  );

  const canShare = canShareImage();
  const grid = el('div', { class: 'grid' });
  for (const p of list) grid.append(card(p));
  view.append(grid);

  function card(p) {
    const where = p.context === 'captive'
      ? (p.facility || '施設名なし')
      : (p.placeName || '場所なし');

    return el('div', { class: 'card unknown-card' },
      el('button', {
        class: 'unknown-img',
        onclick: () => assign(p),
      },
        el('img', { src: blobUrlFor(p.thumb || p.blob), alt: '', loading: 'lazy' }),
        el('span', { class: `pill ${p.context}`, text: p.context === 'wild' ? '野生' : '展示' })
      ),
      el('div', { class: 'card-body' },
        el('p', { class: 'card-ja', text: where }),
        el('p', { class: 'card-date', text: formatDate(p.takenAt, { withTime: false }) }),
        el('div', { class: 'unknown-actions' },
          el('button', { class: 'btn sm primary', onclick: () => assign(p) }, '種を決める'),
          el('button', { class: 'btn sm', onclick: () => photoEditor.edit(p.id, refresh) }, '編集')
        ),
        // 共有シートに渡せる端末でだけ出す。トリミング前の元画像の方が調べやすい。
        canShare
          ? el('button', {
              class: 'btn sm lookup',
              onclick: () => shareImage(p.blob),
            }, '🔎 他のアプリで調べる')
          : null
      )
    );
  }

  async function assign(p) {
    const speciesId = await pickSpecies({
      title: 'この写真の生き物は？',
      preview: p.thumb || p.blob,
      facility: p.context === 'captive' ? p.facility : '',
    });
    if (!speciesId) return;

    await photoStore.assignSpecies(p.id, speciesId);
    const s = sp.get(speciesId);
    toast(s ? `${s.nameJa} に登録しました` : '登録しました');
    if (refresh) await refresh();
  }
}
