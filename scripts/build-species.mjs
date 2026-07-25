/**
 * data/parts/<group>/*.json をマージして data/species/<group>.json を作る。
 * 併せてスキーマ検証・重複排除（全グループ横断）・サイズ帯の再計算を行う。
 *
 *   node scripts/build-species.mjs            # 全グループ
 *   node scripts/build-species.mjs snake      # 指定グループだけ
 *
 * 語彙とサイズ帯は js/groups.js を唯一の情報源として読む（アプリと同じ定義）。
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { GROUPS, sizeBand, ORIGINS, ACTIVITIES, REGIONS, REDLIST, hasSubgroups, subgroupOfFamily } from '../js/groups.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PARTS = join(ROOT, 'data', 'parts');
const OUT_DIR = join(ROOT, 'data', 'species');

// エージェントが「該当区分がない」と報告してきた種を、正しい区分に直す
const REDLIST_FIX = {
  'incilius-periglenes': '絶滅(EX)',            // キンイロヒキガエル：絶滅
  'nectophrynoides-asperginis': '野生絶滅(EW)', // キハンシコモチヒキガエル：野生絶滅
};

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const targets = only.length ? GROUPS.filter((g) => only.includes(g.id)) : GROUPS;
if (only.length && targets.length !== only.length) {
  console.error(`不明なグループ: ${only.filter((o) => !GROUPS.some((g) => g.id === o)).join(', ')}`);
  process.exit(1);
}

const warnings = [];
const errors = [];

// 重複チェックは全グループ横断。今回作らないグループの既存出力も読み込んでおく。
const seenId = new Map();     // id -> どこにあるか
const seenSci = new Map();    // 学名(小文字) -> id
for (const g of GROUPS) {
  if (targets.some((t) => t.id === g.id)) continue;
  const f = join(OUT_DIR, `${g.id}.json`);
  if (!existsSync(f)) continue;
  for (const s of JSON.parse(readFileSync(f, 'utf8'))) {
    seenId.set(s.id, `${g.id}(既存)`);
    seenSci.set(s.nameSci.toLowerCase(), s.id);
  }
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const report = [];

for (const g of targets) {
  const dir = join(PARTS, g.id);
  if (!existsSync(dir)) {
    warnings.push(`${g.id}: data/parts/${g.id}/ がありません（未着手）`);
    continue;
  }

  console.log(`\n[${g.name}]`);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const byId = new Map();

  for (const file of files) {
    let list;
    try {
      list = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (err) {
      errors.push(`${g.id}/${file}: JSONとして読めません — ${err.message}`);
      continue;
    }
    if (!Array.isArray(list)) {
      errors.push(`${g.id}/${file}: 配列ではありません`);
      continue;
    }

    for (const raw of list) {
      const s = clean(raw, `${g.id}/${file}`, g);
      if (!s) continue;

      if (seenId.has(s.id)) {
        warnings.push(`重複(id): ${s.id} — ${g.id}/${file} の方を捨てました（${seenId.get(s.id)}）`);
        continue;
      }
      const sciKey = s.nameSci.toLowerCase();
      if (seenSci.has(sciKey)) {
        warnings.push(`重複(学名): ${s.nameSci} (${g.id}/${file}) — 先に登録された ${seenSci.get(sciKey)} を残しました`);
        continue;
      }
      seenId.set(s.id, `${g.id}/${file}`);
      seenSci.set(sciKey, s.id);
      byId.set(s.id, s);
    }
    console.log(`  ${file.padEnd(18)} ${String(list.length).padStart(3)}件`);
  }

  const out = [...byId.values()].sort((a, b) =>
    a.family.localeCompare(b.family, 'ja') || a.nameJa.localeCompare(b.nameJa, 'ja'));

  // グループ（科の上の階層）を使うグループは、全科が subgroups に載っているか確認する。
  // 未登録の科はアプリで「その他のなかま」に落ちるので、気づけるよう警告に出す。
  if (hasSubgroups(g.id)) {
    const uncovered = [...new Set(out.map((s) => s.family))]
      .filter((f) => subgroupOfFamily(g.id, f) === 'other');
    for (const f of uncovered) {
      warnings.push(`${g.id}: 科「${f}」が groups.js の subgroups に未登録（「その他のなかま」に入ります）`);
    }
  }

  writeFileSync(join(OUT_DIR, `${g.id}.json`), JSON.stringify(out, null, 1) + '\n', 'utf8');
  report.push({ g, out });
}

function clean(s, where0, g) {
  const where = `${where0}/${s?.id || s?.nameSci || '?'}`;
  const need = ['id', 'nameJa', 'nameSci', 'family', 'description'];
  for (const k of need) {
    if (!s?.[k] || typeof s[k] !== 'string') {
      errors.push(`${where}: ${k} がありません`);
      return null;
    }
  }
  if (!/^[a-z0-9-]+$/.test(s.id)) {
    errors.push(`${where}: id に使えない文字があります`);
    return null;
  }

  const t = s.tags || {};
  const sizeMm = Array.isArray(s.sizeMm) && s.sizeMm.length === 2 && s.sizeMm.every(Number.isFinite)
    ? [Math.min(...s.sizeMm), Math.max(...s.sizeMm)]
    : null;
  if (!sizeMm) warnings.push(`${where}: sizeMm が不正`);

  const pick = (v, allowed) => (Array.isArray(v) ? v : [v]).filter((x) => allowed.includes(x));

  const habitat = pick(t.habitat, g.habitats);
  if (!habitat.length) {
    warnings.push(`${where}: habitat が不正 (${JSON.stringify(t.habitat)}) — ${g.name}で使えるのは ${g.habitats.join('/')}`);
  }

  const region = pick(t.region, REGIONS);
  if (!region.length) warnings.push(`${where}: region が不正 (${JSON.stringify(t.region)})`);

  const activity = pick(t.activity, ACTIVITIES);
  const origin = ORIGINS.includes(t.origin) ? t.origin : '国外';
  if (origin !== '国外' && !region.includes('日本')) {
    warnings.push(`${where}: ${origin} なのに region に「日本」がありません`);
  }

  let redlist = REDLIST_FIX[s.id] || t.redlist;
  if (!REDLIST.includes(redlist)) {
    warnings.push(`${where}: redlist が不正 (${redlist}) → 情報不足(DD) にしました`);
    redlist = '情報不足(DD)';
  }

  const len = [...s.description].length;
  if (len < 40 || len > 220) warnings.push(`${where}: description が ${len}字`);

  return {
    id: s.id,
    group: g.id,
    nameJa: s.nameJa.trim(),
    nameSci: s.nameSci.trim(),
    nameEn: (s.nameEn || '').trim(),
    family: s.family.trim(),
    familySci: (s.familySci || '').trim(),
    sizeMm,
    description: s.description.trim(),
    tags: {
      habitat,
      origin,
      size: sizeMm ? sizeBand(sizeMm[1], g.id) : '',   // 体長から機械的に決め直す
      activity: activity.length ? activity : ['夜行性'],
      toxic: g.toxic.show ? !!t.toxic : false,         // 毒の区分を持たないグループは常に false
      region,
      breeding: (t.breeding || '不明').trim(),
      redlist,
    },
    zooDisplay: !!s.zooDisplay,
  };
}

/* ---- レポート ---- */

console.log('\n=== data/species ===');
let grand = 0;
for (const { g, out } of report) {
  const count = (fn) => out.filter(fn).length;
  grand += out.length;
  console.log(
    `${g.name.padEnd(8, '　')} ${String(out.length).padStart(4)}種` +
    `  在来 ${String(count((s) => s.tags.origin === '在来')).padStart(3)}` +
    `  外来 ${String(count((s) => s.tags.origin === '外来')).padStart(2)}` +
    `  国外 ${String(count((s) => s.tags.origin === '国外')).padStart(4)}` +
    `  国内展示 ${String(count((s) => s.zooDisplay)).padStart(3)}` +
    `  科 ${String(new Set(out.map((s) => s.family)).size).padStart(2)}`
  );
}
console.log(`${'合計'.padEnd(8, '　')} ${String(grand).padStart(4)}種`);

if (warnings.length) {
  console.log(`\n--- 警告 ${warnings.length}件 ---`);
  for (const w of warnings) console.log('  ' + w);
}
if (errors.length) {
  console.log(`\n--- エラー ${errors.length}件 ---`);
  for (const e of errors) console.log('  ' + e);
  process.exitCode = 1;
}
