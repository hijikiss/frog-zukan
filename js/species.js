/**
 * 種データの一元管理。
 *
 * data/species/<group>.json（アプリ同梱の初期データ、読み取り専用）に
 * IndexedDB の speciesOverrides（自分の編集・追加・削除）を重ねて「表示用の種リスト」を作る。
 *
 * この二層構造のおかげで、アプリを更新して同梱データに種が増えても
 * 自分が直した記述は上書きされずに残る。
 *
 * 全グループ（カエル・ヘビ・カメ…）を1つのリストで持ち、group フィールドで絞る。
 * 施設別ページや検索を全グループ横断で書けるようにするため。
 */

import { overrides, photos } from './db.js';
import {
  GROUPS, DEFAULT_GROUP, dataFile, group as groupOf, sizeBand as bandOf,
  hasSubgroups, subgroupsOf, subgroupOfFamily, subgroupName,
} from './groups.js';

export { ORIGINS, SIZES, ACTIVITIES, REGIONS, REDLIST, GROUPS } from './groups.js';

/** そのグループで使う生息環境の語彙 */
export const habitatsOf = (groupId) => groupOf(groupId).habitats;

export const STATUS = {
  UNSEEN: 'unseen',
  CAPTIVE: 'captive',
  WILD: 'wild',
};
export const STATUS_LABEL = {
  unseen: '未観察',
  captive: '展示で観察',
  wild: '野生で観察',
};

let base = [];            // 同梱データ（全グループ）そのまま
let merged = [];          // 表示用（override 適用後）
let byId = new Map();
let photoIndex = new Map(); // speciesId -> { count, hasWild, hasCaptive, cover }

/* ---------------- 読み込み ---------------- */

export async function load() {
  const lists = await Promise.all(GROUPS.map(async (g) => {
    const res = await fetch(dataFile(g.id), { cache: 'no-cache' });
    // 1グループが欠けても他は表示できるようにする（データ追加の途中でも壊れない）
    if (!res.ok) {
      console.warn(`${dataFile(g.id)} を読み込めませんでした`);
      return [];
    }
    const list = await res.json();
    return list.map((s) => (s.group ? s : { ...s, group: g.id }));
  }));

  base = lists.flat();
  if (!base.length) throw new Error('種データを読み込めませんでした');
  await rebuild();
}

export async function rebuild() {
  const ov = await overrides.all();
  const ovMap = new Map(ov.map((o) => [o.id, o]));

  const out = [];
  for (const sp of base) {
    const o = ovMap.get(sp.id);
    if (o && o._deleted) continue;
    out.push(o ? mergeOne(sp, o) : sp);
    ovMap.delete(sp.id);
  }
  // frogs.json に無い = 自分で追加した種
  for (const o of ovMap.values()) {
    if (o._deleted) continue;
    out.push(normalize(o));
  }

  merged = out;
  byId = new Map(out.map((s) => [s.id, s]));
  await refreshPhotoIndex();
  return merged;
}

function mergeOne(baseSp, ov) {
  const s = { ...baseSp, ...stripMeta(ov) };
  s.tags = { ...baseSp.tags, ...(ov.tags || {}) };
  s._edited = true;
  return normalize(s);
}

function stripMeta(o) {
  const { _deleted, ...rest } = o;
  void _deleted;
  return rest;
}

function normalize(s) {
  const t = s.tags || {};
  // group が無いのは古いバックアップ由来の自作種。カエル図鑑時代のものなのでカエル扱い。
  const group = s.group || DEFAULT_GROUP;
  return {
    ...s,
    group,
    family: s.family || '不明',
    familySci: s.familySci || '',
    sizeMm: Array.isArray(s.sizeMm) && s.sizeMm.length === 2 ? s.sizeMm : null,
    tags: {
      habitat: t.habitat || [],
      origin: t.origin || '国外',
      size: t.size || (s.sizeMm ? sizeBand(s.sizeMm[1], group) : ''),
      activity: t.activity || [],
      toxic: !!t.toxic,
      region: t.region || [],
      breeding: t.breeding || '不明',
      redlist: t.redlist || '情報不足(DD)',
    },
  };
}

/** 体長 → サイズ帯。基準はグループごと（groups.js） */
export const sizeBand = bandOf;

/* ---------------- 写真インデックス ---------------- */

export async function refreshPhotoIndex() {
  const all = await photos.all();
  const idx = new Map();
  for (const p of all) {
    let e = idx.get(p.speciesId);
    if (!e) {
      e = { count: 0, hasWild: false, hasCaptive: false, cover: null, coverSort: '' };
      idx.set(p.speciesId, e);
    }
    e.count++;
    if (p.context === 'wild') e.hasWild = true;
    else e.hasCaptive = true;

    // カバー写真は「野生 > 展示」、同条件なら新しい方
    const sort = (p.context === 'wild' ? '1' : '0') + (p.takenAt || p.createdAt || '');
    if (sort > e.coverSort) {
      e.coverSort = sort;
      e.cover = p.thumb || p.blob;
    }
  }
  photoIndex = idx;
  return idx;
}

export function statusOf(speciesId) {
  const e = photoIndex.get(speciesId);
  if (!e) return STATUS.UNSEEN;
  if (e.hasWild) return STATUS.WILD;
  return STATUS.CAPTIVE;
}

export const photoInfo = (speciesId) => photoIndex.get(speciesId) || null;

/** groupId 省略時は全グループ合計 */
export function progress(groupId) {
  const list = all(groupId);
  let observed = 0;
  let wild = 0;
  for (const s of list) {
    const st = statusOf(s.id);
    if (st === STATUS.UNSEEN) continue;
    observed++;
    if (st === STATUS.WILD) wild++;
  }
  return { total: list.length, observed, wild, captive: observed - wild };
}

/* ---------------- 取得 ---------------- */

/** groupId 省略時は全グループ */
export const all = (groupId) => (groupId ? merged.filter((s) => s.group === groupId) : merged);
export const get = (id) => byId.get(id);

/**
 * そのグループの科一覧。subgroupKey を渡すとそのグループ（科の上の階層）の科だけに絞る。
 * 各科について種数と観察数（observed / wild）も返す。件数の多い順。
 */
export function families(groupId, subgroupKey) {
  const m = new Map();
  for (const s of all(groupId)) {
    if (subgroupKey && subgroupOfFamily(groupId, s.family) !== subgroupKey) continue;
    let e = m.get(s.family);
    if (!e) {
      e = { name: s.family, familySci: s.familySci || '', count: 0, observed: 0, wild: 0 };
      m.set(s.family, e);
    }
    e.count++;
    if (!e.familySci && s.familySci) e.familySci = s.familySci;
    const st = statusOf(s.id);
    if (st !== STATUS.UNSEEN) { e.observed++; if (st === STATUS.WILD) e.wild++; }
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

/**
 * そのグループの「グループ（科の上の階層）」一覧。定義順で、載っていない科は末尾の
 * 「その他のなかま」にまとまる。各グループの種数と観察数（observed / wild）つき。
 * subgroups が定義されていないグループでは空配列。
 */
export function subgroups(groupId) {
  if (!hasSubgroups(groupId)) return [];
  const order = new Map(subgroupsOf(groupId).map((s, i) => [s.key, i]));
  const acc = new Map();
  for (const s of all(groupId)) {
    const key = subgroupOfFamily(groupId, s.family);
    let e = acc.get(key);
    if (!e) {
      e = { key, name: subgroupName(groupId, key), total: 0, observed: 0, wild: 0 };
      acc.set(key, e);
    }
    e.total++;
    const st = statusOf(s.id);
    if (st !== STATUS.UNSEEN) { e.observed++; if (st === STATUS.WILD) e.wild++; }
  }
  // 定義順。'other'（未登録の科）は最後に。
  return [...acc.values()].sort((a, b) =>
    (order.has(a.key) ? order.get(a.key) : Infinity) - (order.has(b.key) ? order.get(b.key) : Infinity));
}

/* ---------------- 検索・絞り込み ---------------- */

const kata = (s) =>
  String(s || '').replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

const norm = (s) => kata(String(s || '').toLowerCase().trim());

export function search(list, q) {
  const query = norm(q);
  if (!query) return list;
  const terms = query.split(/\s+/).filter(Boolean);
  return list.filter((s) => {
    const hay = norm([s.nameJa, s.nameSci, s.nameEn, s.family, s.familySci].join(' '));
    return terms.every((t) => hay.includes(t));
  });
}

/**
 * filters = {
 *   habitat: [], origin: [], size: [], activity: [], region: [], redlist: [], family: [],
 *   toxic: null|true|false, zooDisplay: false, status: []   // 'unseen'|'captive'|'wild'
 * }
 */
export function filter(list, f) {
  const has = (arr) => Array.isArray(arr) && arr.length > 0;
  const anyOf = (values, want) => want.some((w) => values.includes(w));

  return list.filter((s) => {
    const t = s.tags;
    if (has(f.habitat) && !anyOf(t.habitat, f.habitat)) return false;
    if (has(f.origin) && !f.origin.includes(t.origin)) return false;
    if (has(f.size) && !f.size.includes(t.size)) return false;
    if (has(f.activity) && !anyOf(t.activity, f.activity)) return false;
    if (has(f.region) && !anyOf(t.region, f.region)) return false;
    if (has(f.redlist) && !f.redlist.includes(t.redlist)) return false;
    if (has(f.family) && !f.family.includes(s.family)) return false;
    if (f.toxic === true && !t.toxic) return false;
    if (f.toxic === false && t.toxic) return false;
    if (f.zooDisplay && !s.zooDisplay) return false;
    if (has(f.status) && !f.status.includes(statusOf(s.id))) return false;
    return true;
  });
}

export const SORTS = {
  taxonomy: { label: '分類順', fn: (a, b) => (a.family || '').localeCompare(b.family || '', 'ja') || (a.nameJa || '').localeCompare(b.nameJa || '', 'ja') },
  name:     { label: '名前順', fn: (a, b) => (a.nameJa || '').localeCompare(b.nameJa || '', 'ja') },
  observed: { label: '観察済み優先', fn: (a, b) => rank(b.id) - rank(a.id) || (a.nameJa || '').localeCompare(b.nameJa || '', 'ja') },
  size:     { label: '大きい順', fn: (a, b) => (b.sizeMm?.[1] || 0) - (a.sizeMm?.[1] || 0) },
};

const rank = (id) => ({ wild: 2, captive: 1, unseen: 0 })[statusOf(id)];

export function sort(list, key) {
  const s = SORTS[key] || SORTS.taxonomy;
  return [...list].sort(s.fn);
}

/* ---------------- 編集 ---------------- */

const FIELDS = ['nameJa', 'nameSci', 'nameEn', 'family', 'familySci', 'sizeMm', 'description', 'zooDisplay', 'tags', 'group'];

/** 種の編集を保存。frogs.json 由来の種なら差分だけ、自作種なら全体を保存する。 */
export async function saveSpecies(id, patch) {
  const isBase = base.some((s) => s.id === id);
  const existing = (await overrides.all()).find((o) => o.id === id);
  const rec = { id, ...(existing || {}) };

  for (const k of FIELDS) {
    if (k in patch) rec[k] = patch[k];
  }
  if (!isBase) rec._custom = true;
  delete rec._deleted;

  await overrides.put(rec);
  await rebuild();
  return get(id);
}

/** 新しい種を自分で追加する。group は必須（省略時はカエル扱い） */
export async function addSpecies(data) {
  const id = (data.id || slugify(data.nameSci || data.nameJa) || 'custom') + '';
  let uniqueId = id;
  let i = 2;
  while (byId.has(uniqueId)) uniqueId = `${id}-${i++}`;

  await overrides.put({ ...data, group: data.group || DEFAULT_GROUP, id: uniqueId, _custom: true });
  await rebuild();
  return get(uniqueId);
}

/** 種を図鑑から消す（自作種は削除、同梱種は非表示フラグ） */
export async function removeSpecies(id) {
  const isBase = base.some((s) => s.id === id);
  if (isBase) await overrides.put({ id, _deleted: true });
  else await overrides.remove(id);
  await rebuild();
}

/** 同梱データの内容に戻す */
export async function resetSpecies(id) {
  await overrides.remove(id);
  await rebuild();
  return get(id);
}

export const isEdited = (id) => !!get(id)?._edited;
export const isCustom = (id) => !base.some((s) => s.id === id);

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
