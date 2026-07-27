/** ホーム画面：生き物グループを選ぶ／全グループ横断で名前検索 */

import * as sp from '../species.js';
import { GROUPS } from '../groups.js';
import * as photoStore from '../photos.js';
import * as photoEditor from './photo-editor.js';
import { silhouette } from '../icons.js';
import { el, clear } from '../ui.js';
import { speciesCard } from './card.js';

// 検索文字を覚えておく（ホームに戻っても消えない）
let query = '';

export async function render(view, { refresh } = {}) {
  clear(view);
  const body = el('div');
  const unknownCount = (await photoStore.unidentified()).length;

  const input = el('input', {
    type: 'search',
    placeholder: 'すべての生き物を名前で検索',
    value: query,
    enterkeyhint: 'search',
    oninput: (e) => { query = e.target.value; paint(); },
  });

  view.append(
    el('div', { class: 'searchrow' },
      el('div', { class: 'search' },
        input,
        el('button', {
          class: 'clear',
          'aria-label': '検索をクリア',
          onclick: () => { query = ''; input.value = ''; paint(); },
        }, '✕')
      )
    ),
    body
  );
  paint();

  function paint() {
    clear(body);
    if (query.trim()) { body.append(results(query.trim())); return; }

    const grid = el('div', { class: 'home-grid' });
    for (const g of GROUPS) grid.append(tile(g));
    const total = sp.progress();
    // append は null を「null」という文字にしてしまうので、出すものだけ渡す
    body.append(photoButton());
    if (unknownCount) body.append(unknownNotice(unknownCount));
    body.append(
      el('p', { class: 'home-lead', text: '見たい生き物を選ぶか、上でまとめて検索できます。' }),
      grid,
      el('p', { class: 'home-total' },
        `全${total.total}種中 `,
        el('b', { text: String(total.observed) }),
        '種観察済み（うち野生 ',
        el('b', { text: String(total.wild) }),
        '種）'
      )
    );
  }

  /** 写真を起点に記録する（撮ってから種を決める流れ） */
  function photoButton() {
    const input = el('input', {
      type: 'file',
      accept: 'image/*',
      multiple: true,
      style: 'display:none',
      onchange: async (e) => {
        const files = [...e.target.files];
        e.target.value = '';
        await photoEditor.addPhotos(files, { onSaved: refresh });
      },
    });
    return el('div', {},
      el('button', { class: 'photo-first', onclick: () => input.click() },
        el('span', { class: 'ico' }, '📷'),
        el('span', { class: 'main' },
          el('span', { class: 't' }, '写真から記録する'),
          el('span', { class: 's' }, '撮った写真を選んで、あとから種を決められます')
        )
      ),
      input
    );
  }

  // paint() から呼ぶので、巻き上げが効く関数宣言にしておく（const だと初期化前に呼ばれる）
  function unknownNotice(n) {
    return el('a', { class: 'unknown-notice', href: '#/unidentified' },
      el('span', { class: 'ico' }, '🔍'),
      el('span', { class: 'main' }, `未同定の写真が${n}枚あります`),
      el('span', { class: 'chev' }, '›'));
  }
}

/** 全グループ横断の検索結果。どのグループの種かをカードに出す。 */
function results(q) {
  const list = sp.sort(sp.search(sp.all(), q), 'name');
  const wrap = el('div');
  wrap.append(el('div', { class: 'result-count', style: 'margin:2px 4px 8px', text: `${list.length}種を表示` }));
  if (!list.length) {
    wrap.append(el('div', { class: 'empty-state' },
      el('span', { class: 'big' }, '🔎'), '名前に合う種が見つかりませんでした。'));
    return wrap;
  }
  const grid = el('div', { class: 'grid' });
  for (const s of list) grid.append(speciesCard(s, { showGroup: true }));
  wrap.append(grid);
  return wrap;
}

function tile(g) {
  const p = sp.progress(g.id);
  const ready = p.total > 0;
  const pct = (n) => (p.total ? (n / p.total) * 100 : 0);

  return el('a', {
    class: 'home-tile' + (ready ? '' : ' pending'),
    href: `#/g/${g.id}`,
  },
    el('div', { class: 'home-ico' }, silhouette(g.id)),
    el('div', { class: 'home-name', text: g.name }),
    el('div', { class: 'home-note', text: g.note }),
    ready
      ? el('div', { class: 'home-count' },
          el('b', { text: String(p.observed) }), ` / ${p.total}種`)
      : el('div', { class: 'home-count dim', text: '準備中' }),
    el('div', { class: 'home-bar', 'aria-hidden': 'true' },
      el('div', { class: 'home-fill wild', style: `width:${pct(p.wild)}%` }),
      el('div', { class: 'home-fill captive', style: `width:${pct(p.captive)}%` })
    )
  );
}
