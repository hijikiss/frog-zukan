/** ホーム画面：生き物グループを選ぶ */

import * as sp from '../species.js';
import { GROUPS } from '../groups.js';
import { silhouette } from '../icons.js';
import { el, clear } from '../ui.js';

export function render(view) {
  clear(view);

  const grid = el('div', { class: 'home-grid' });
  for (const g of GROUPS) grid.append(tile(g));

  const total = sp.progress();

  view.append(
    el('p', { class: 'home-lead', text: '見たい生き物を選んでください。' }),
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
