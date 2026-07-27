/** 種情報の編集・追加モーダル（同梱データの誤りを直すため） */

import * as sp from '../species.js';
import { GROUPS, group as groupOf, DEFAULT_GROUP } from '../groups.js';
import { el, clear, modal, toast, confirmDialog } from '../ui.js';

/**
 * species を渡せば編集、渡さなければ新規追加。
 * 新規のときは groupId で初期グループを指定できる。
 */
export function open({ species, groupId, onSaved }) {
  const isNew = !species;
  const s = species || {
    nameJa: '', nameSci: '', nameEn: '', family: '', familySci: '',
    sizeMm: null, description: '', zooDisplay: false,
    tags: {
      habitat: [], origin: '国外', size: '', activity: [], toxic: false,
      region: [], breeding: '', redlist: '情報不足(DD)',
    },
  };
  const t = s.tags;

  // 生き物グループ。既存種は動かさず、新規のときだけ選ばせる。
  let g = groupOf(species?.group || groupId || DEFAULT_GROUP);

  const f = {
    nameJa: input('text', s.nameJa),
    nameSci: input('text', s.nameSci),
    nameEn: input('text', s.nameEn),
    family: input('text', s.family),
    familySci: input('text', s.familySci),
    sizeMin: input('number', s.sizeMm?.[0] ?? ''),
    sizeMax: input('number', s.sizeMm?.[1] ?? ''),
    breeding: input('text', t.breeding),
  };
  f.sizeMin.min = 1;
  f.sizeMax.min = 1;

  const desc = el('textarea', { rows: 5 });
  desc.value = s.description || '';

  // 別名は「読点・改行区切り」で編集する（展示名や通称を足せるように）
  const aliasInput = el('textarea', { rows: 2 });
  aliasInput.value = (s.aliases || []).join('、');

  const originSel = select(sp.ORIGINS, t.origin);
  const redlistSel = select(sp.REDLIST, t.redlist);

  const habitat = new Set(t.habitat);
  const activity = new Set(t.activity);
  const region = new Set(t.region);

  const toxicChk = checkbox('毒あり（皮膚毒・毒腺）', t.toxic);
  const zooChk = checkbox('国内の動物園・水族館で展示されやすい', !!s.zooDisplay);

  const sizeHint = el('div', { class: 'hint' });
  const sizeLabel = el('label', {});
  const habitatBox = el('div');
  const toxicBox = el('div', { class: 'field' });

  const groupSel = el('select', {
    onchange: () => { g = groupOf(groupSel.value); paintGroupParts(); },
  }, GROUPS.map((x) => el('option', { value: x.id, selected: x.id === g.id, text: x.name })));

  const updateSizeHint = () => {
    const band = sp.sizeBand(Number(f.sizeMax.value), g.id);
    sizeHint.textContent = band
      ? `体サイズ帯: ${band}（${g.name}の基準で最大値から自動判定）`
      : '最大値からサイズ帯を自動判定します';
  };
  f.sizeMax.addEventListener('input', updateSizeHint);

  /** グループで変わる部分（生息環境の語彙・体長の呼び方・毒の有無）を描き直す */
  function paintGroupParts() {
    for (const h of [...habitat]) if (!g.habitats.includes(h)) habitat.delete(h);
    clear(habitatBox);
    habitatBox.append(chipField('生息環境', g.habitats, habitat));

    clear(toxicBox);
    if (g.toxic.show) toxicBox.append(toxicChk.wrap);
    else toxicChk.input.checked = false;

    sizeLabel.textContent = `${g.lengthLabel}（mm）`;
    updateSizeHint();
  }

  const body = el('div', {},
    isNew
      ? field('生き物グループ', groupSel)
      : el('div', { class: 'field' },
          el('label', {}, '生き物グループ'),
          el('div', { class: 'hint', style: 'margin-top:0', text: `${g.name}（${g.taxon}）` })),
    field('和名 *', f.nameJa),
    field('学名 *', f.nameSci),
    field('英名', f.nameEn),
    el('div', { class: 'field' },
      el('label', {}, '別名・展示名'),
      aliasInput,
      el('div', { class: 'hint', text: '読点（、）か改行で区切ります。施設の解説板やショップの呼び名を入れておくと、その名前でも検索できます。' })
    ),
    el('div', { style: 'display:flex;gap:8px' },
      el('div', { style: 'flex:1' }, field('科（和名）', f.family)),
      el('div', { style: 'flex:1' }, field('科（学名）', f.familySci))
    ),
    el('div', { class: 'field' },
      sizeLabel,
      el('div', { style: 'display:flex;gap:8px;align-items:center' },
        f.sizeMin, el('span', { text: '〜' }), f.sizeMax),
      sizeHint
    ),
    habitatBox,
    field('在来 / 外来', originSel),
    chipField('活動時間', sp.ACTIVITIES, activity),
    chipField('分布', sp.REGIONS, region),
    field('繁殖期・産卵期', f.breeding),
    field('レッドリスト区分', redlistSel),
    toxicBox,
    el('div', { class: 'field' }, zooChk.wrap),
    field('説明', desc)
  );

  paintGroupParts();

  const footer = [
    isNew
      ? el('button', { class: 'btn', onclick: () => m.close() }, 'キャンセル')
      : el('button', {
          class: 'btn',
          onclick: async () => {
            if (sp.isCustom(s.id)) {
              if (!(await confirmDialog('この種を図鑑から削除しますか？', { okLabel: '削除', danger: true }))) return;
              await sp.removeSpecies(s.id);
              m.close();
              toast('種を削除しました');
              location.hash = `#/g/${g.id}`;
              if (onSaved) onSaved();
              return;
            }
            if (!(await confirmDialog('同梱データの内容に戻しますか？（自分の編集は失われます）', { okLabel: '戻す' }))) return;
            await sp.resetSpecies(s.id);
            m.close();
            toast('初期データに戻しました');
            if (onSaved) onSaved();
          },
        }, sp.isCustom(s.id) ? '削除' : '初期値に戻す'),
    el('button', { class: 'btn primary', onclick: save }, isNew ? '追加' : '保存'),
  ];

  const m = modal({ title: isNew ? '種を追加' : '種の情報を編集', body, footer });

  async function save() {
    const nameJa = f.nameJa.value.trim();
    const nameSci = f.nameSci.value.trim();
    if (!nameJa || !nameSci) {
      toast('和名と学名は必須です');
      return;
    }

    const min = Number(f.sizeMin.value);
    const max = Number(f.sizeMax.value);
    const sizeMm = Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > 0
      ? [Math.min(min, max), Math.max(min, max)]
      : null;

    const patch = {
      group: g.id,
      nameJa,
      nameSci,
      nameEn: f.nameEn.value.trim(),
      aliases: [...new Set(aliasInput.value.split(/[、,\n]/).map((a) => a.trim()).filter(Boolean))],
      family: f.family.value.trim() || '不明',
      familySci: f.familySci.value.trim(),
      sizeMm,
      description: desc.value.trim(),
      zooDisplay: zooChk.input.checked,
      tags: {
        habitat: [...habitat],
        origin: originSel.value,
        size: sizeMm ? sp.sizeBand(sizeMm[1], g.id) : '',
        activity: [...activity],
        toxic: toxicChk.input.checked,
        region: [...region],
        breeding: f.breeding.value.trim() || '不明',
        redlist: redlistSel.value,
      },
    };

    try {
      if (isNew) {
        const created = await sp.addSpecies(patch);
        m.close();
        toast('種を追加しました');
        if (onSaved) onSaved();
        location.hash = `#/s/${encodeURIComponent(created.id)}`;
      } else {
        await sp.saveSpecies(s.id, patch);
        m.close();
        toast('保存しました');
        if (onSaved) onSaved();
      }
    } catch (err) {
      toast(err.message || '保存に失敗しました');
    }
  }
}

/* ---- 部品 ---- */

function input(type, value) {
  const i = el('input', { type });
  i.value = value ?? '';
  return i;
}

function select(options, value) {
  return el('select', {}, options.map((o) =>
    el('option', { value: o, selected: o === value, text: o })));
}

function field(label, control) {
  return el('div', { class: 'field' }, el('label', { text: label }), control);
}

function checkbox(label, checked) {
  const input = el('input', { type: 'checkbox' });
  input.checked = !!checked;
  const wrap = el('label', {
    style: 'display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:var(--text)',
  }, input, label);
  return { wrap, input };
}

function chipField(label, values, set) {
  const chips = values.map((v) => {
    const b = el('button', {
      type: 'button',
      class: 'chip' + (set.has(v) ? ' on' : ''),
      text: v,
      onclick: () => {
        if (set.has(v)) set.delete(v);
        else set.add(v);
        b.classList.toggle('on', set.has(v));
      },
    });
    return b;
  });
  return el('div', { class: 'field' },
    el('label', { text: label }),
    el('div', { class: 'chips' }, chips)
  );
}
