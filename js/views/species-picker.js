/**
 * 種を選ぶモーダル。
 *   - 写真から登録するとき（先に写真、あとで種）
 *   - 未同定で登録した写真に、あとから種を決めるとき
 * の2か所で使う。
 */

import * as sp from '../species.js';
import { group as groupOf } from '../groups.js';
import { UNIDENTIFIED } from '../photos.js';
import { el, modal, blobUrlFor, silhouette } from '../ui.js';

const MAX_ROWS = 40;   // 全813種を一度に並べると重いので、検索前は最近見た種だけ出す

/**
 * @param opts.allowUnknown 「あとで同定する」を出すか
 * @param opts.preview      上に出す写真（Blob）
 * @returns {Promise<string|null>} 選ばれた種の id、'__unidentified__'、閉じたら null
 */
export function pickSpecies({ allowUnknown = false, preview = null, title = '種を選ぶ' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      m.close();
      resolve(value);
    };

    const results = el('div', { class: 'list-rows picker-rows' });

    const input = el('input', {
      type: 'search',
      placeholder: '和名・学名・英名で検索',
      enterkeyhint: 'search',
      oninput: () => paint(),
    });

    const body = el('div', {},
      preview ? el('div', { class: 'picker-preview' }, el('img', { src: blobUrlFor(preview), alt: '' })) : null,
      el('div', { class: 'searchrow', style: 'margin-bottom:8px' },
        el('div', { class: 'search' }, input)
      ),
      results
    );

    const footer = [
      el('button', { class: 'btn', onclick: () => finish(null) }, 'キャンセル'),
      allowUnknown
        ? el('button', { class: 'btn primary', onclick: () => finish(UNIDENTIFIED) }, 'あとで同定する')
        : null,
    ].filter(Boolean);

    const m = modal({ title, body, footer, onClose: () => finish(null) });
    paint();
    setTimeout(() => input.focus(), 50);

    function paint() {
      const q = input.value.trim();
      const list = q ? sp.search(sp.all(), q) : recentlyUsed();

      results.replaceChildren();
      if (!list.length) {
        results.append(el('div', { class: 'empty-state', style: 'padding:20px 8px' },
          el('span', { class: 'big' }, '🔎'),
          q ? '見つかりませんでした。' : '名前で検索してください。'));
        return;
      }

      for (const s of list.slice(0, MAX_ROWS)) {
        results.append(
          el('button', {
            class: 'row',
            type: 'button',
            onclick: () => finish(s.id),
          },
            thumb(s),
            el('span', { class: 'main' },
              el('span', { class: 't', text: s.nameJa }),
              el('span', { class: 's', text: `${groupOf(s.group).name} ・ ${s.family}` })
            )
          )
        );
      }
      if (list.length > MAX_ROWS) {
        results.append(el('div', { class: 'hint', style: 'padding:8px 12px',
          text: `ほか${list.length - MAX_ROWS}種。検索で絞り込んでください。` }));
      }
    }
  });
}

/** 写真を登録したことがある種（＝また使う可能性が高い）を先に見せる */
function recentlyUsed() {
  return sp.all()
    .filter((s) => sp.photoInfo(s.id))
    .sort((a, b) => a.nameJa.localeCompare(b.nameJa, 'ja'));
}

function thumb(s) {
  const info = sp.photoInfo(s.id);
  const box = el('span', { class: 'ico stat-thumb' });
  if (info?.cover) box.append(el('img', { src: blobUrlFor(info.cover), alt: '', loading: 'lazy' }));
  else box.append(silhouette(s.group));
  return box;
}
