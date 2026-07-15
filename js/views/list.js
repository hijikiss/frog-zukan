/** 一覧画面：検索・タグ絞り込み・観察ステータス絞り込み */

import * as sp from '../species.js';
import { el, clear, blobUrlFor, silhouette } from '../ui.js';

// 画面を離れて戻ってきても絞り込みが消えないよう、モジュールスコープに置く
const state = {
  q: '',
  sort: 'taxonomy',
  open: false,
  scroll: 0,
  f: {
    habitat: [], origin: [], size: [], activity: [], region: [], redlist: [], family: [],
    toxic: null, zooDisplay: false, status: [],
  },
};

export function activeFilterCount() {
  const f = state.f;
  let n = 0;
  for (const k of ['habitat', 'origin', 'size', 'activity', 'region', 'redlist', 'family', 'status']) {
    n += f[k].length;
  }
  if (f.toxic !== null) n++;
  if (f.zooDisplay) n++;
  return n;
}

export function render(view) {
  clear(view);

  const results = el('div');
  const filtersBox = el('div');

  const searchInput = el('input', {
    type: 'search',
    placeholder: '和名・学名・英名で検索',
    value: state.q,
    enterkeyhint: 'search',
    oninput: (e) => { state.q = e.target.value; paint(); },
  });

  const toggleBtn = el('button', {
    class: 'filter-toggle' + (activeFilterCount() ? ' on' : ''),
    onclick: () => { state.open = !state.open; paintFilters(); },
  });

  view.append(
    el('div', { class: 'searchrow' },
      el('div', { class: 'search' },
        searchInput,
        el('button', {
          class: 'clear',
          'aria-label': '検索をクリア',
          onclick: () => { state.q = ''; searchInput.value = ''; paint(); },
        }, '✕')
      ),
      toggleBtn
    ),
    filtersBox,
    results
  );

  paintFilters();
  requestAnimationFrame(() => window.scrollTo(0, state.scroll));

  /* ---- 絞り込みパネル ---- */
  function paintFilters() {
    clear(toggleBtn);
    const n = activeFilterCount();
    toggleBtn.classList.toggle('on', n > 0);
    toggleBtn.append('絞り込み', n ? el('span', { class: 'count', text: String(n) }) : '');

    clear(filtersBox);
    if (!state.open) { paint(); return; }

    const group = (title, children) =>
      el('div', { class: 'filter-group' }, el('h4', { text: title }), el('div', { class: 'chips' }, children));

    const multi = (key, values, cls = '') =>
      values.map((v) =>
        el('button', {
          class: `chip ${state.f[key].includes(v) ? 'on ' + cls : ''}`,
          onclick: () => { toggleIn(state.f[key], v); paintFilters(); },
          text: typeof v === 'string' ? v : v.label,
        })
      );

    const statusChips = [
      { v: 'wild', label: '野生で観察', cls: 'wild' },
      { v: 'captive', label: '展示で観察', cls: 'captive' },
      { v: 'unseen', label: '未観察', cls: '' },
    ].map(({ v, label, cls }) =>
      el('button', {
        class: `chip ${state.f.status.includes(v) ? 'on ' + cls : ''}`,
        onclick: () => { toggleIn(state.f.status, v); paintFilters(); },
        text: label,
      })
    );

    const toxicChips = [
      { v: true, label: '毒あり' },
      { v: false, label: '毒なし' },
    ].map(({ v, label }) =>
      el('button', {
        class: `chip ${state.f.toxic === v ? 'on' : ''}`,
        onclick: () => { state.f.toxic = state.f.toxic === v ? null : v; paintFilters(); },
        text: label,
      })
    );

    const zooChip = el('button', {
      class: `chip ${state.f.zooDisplay ? 'on' : ''}`,
      onclick: () => { state.f.zooDisplay = !state.f.zooDisplay; paintFilters(); },
      text: '国内で展示されやすい種',
    });

    const sortSel = el('select', {
      onchange: (e) => { state.sort = e.target.value; paint(); },
      style: 'border:1px solid var(--border);border-radius:8px;padding:5px 8px;background:var(--surface);font-size:12.5px',
    }, Object.entries(sp.SORTS).map(([k, v]) =>
      el('option', { value: k, selected: state.sort === k, text: v.label })
    ));

    filtersBox.append(
      el('div', { class: 'filters' },
        group('観察ステータス', statusChips),
        group('生息環境', multi('habitat', sp.HABITATS)),
        group('在来 / 外来', multi('origin', sp.ORIGINS)),
        group('体サイズ', multi('size', sp.SIZES)),
        group('活動時間', multi('activity', sp.ACTIVITIES)),
        group('毒', [...toxicChips, zooChip]),
        group('分布', multi('region', sp.REGIONS)),
        group('レッドリスト', multi('redlist', sp.REDLIST)),
        group('科', multi('family', sp.families().map((f) => f.name))),
        el('div', { class: 'filter-actions' },
          el('button', {
            class: 'btn sm',
            onclick: () => { resetFilters(); paintFilters(); },
          }, 'すべて解除'),
          el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-dim)' },
            '並び順', sortSel)
        )
      )
    );
    paint();
  }

  /* ---- 結果グリッド ---- */
  function paint() {
    let list = sp.all();
    list = sp.search(list, state.q);
    list = sp.filter(list, state.f);
    list = sp.sort(list, state.sort);

    clear(results);
    results.append(
      el('div', { class: 'result-count', style: 'margin:2px 4px 8px', text: `${list.length}種を表示` })
    );

    if (!list.length) {
      results.append(
        el('div', { class: 'empty-state' },
          el('span', { class: 'big' }, '🔎'),
          '条件に合うカエルがいません。',
          el('div', { style: 'margin-top:12px' },
            el('button', {
              class: 'btn sm',
              onclick: () => { state.q = ''; searchInput.value = ''; resetFilters(); paintFilters(); },
            }, '条件をリセット')
          )
        )
      );
      return;
    }

    const grid = el('div', { class: 'grid' });
    for (const s of list) grid.append(card(s));
    results.append(grid);
  }
}

function resetFilters() {
  state.f = {
    habitat: [], origin: [], size: [], activity: [], region: [], redlist: [], family: [],
    toxic: null, zooDisplay: false, status: [],
  };
}

function toggleIn(arr, v) {
  const i = arr.indexOf(v);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(v);
}

function card(s) {
  const status = sp.statusOf(s.id);
  const info = sp.photoInfo(s.id);

  const imgBox = el('div', { class: 'card-img' + (info?.cover ? '' : ' empty') });
  if (info?.cover) {
    imgBox.append(el('img', { src: blobUrlFor(info.cover), alt: s.nameJa, loading: 'lazy' }));
  } else {
    imgBox.append(silhouette());
  }

  if (status !== 'unseen') {
    imgBox.append(
      el('span', {
        class: `badge ${status}`,
        text: status === 'wild' ? '野生' : '展示',
      })
    );
  }
  if (info && info.count > 1) {
    imgBox.append(el('span', { class: 'badge-count', text: `${info.count}枚` }));
  }

  return el('a', {
    class: 'card' + (status === 'unseen' ? ' unseen' : ''),
    href: `#/s/${encodeURIComponent(s.id)}`,
    onclick: () => { state.scroll = window.scrollY; },
  },
    imgBox,
    el('div', { class: 'card-body' },
      el('p', { class: 'card-ja', text: s.nameJa }),
      el('p', { class: 'card-sci', text: s.nameSci })
    )
  );
}
