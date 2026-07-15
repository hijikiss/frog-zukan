/**
 * data/parts/*.json をマージして data/frogs.json を作る。
 * 併せてスキーマ検証・重複排除・サイズ帯の再計算を行う。
 *
 *   node scripts/build-frogs.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PARTS = join(ROOT, 'data', 'parts');

const HABITATS = ['樹上棲', '地表棲', '地中棲', '水棲', '半水棲', '流水性'];
const ORIGINS = ['在来', '外来', '国外'];
const ACTIVITIES = ['夜行性', '昼行性', '薄明薄暮性'];
const REGIONS = ['日本', '東アジア', '東南アジア', '南アジア', '中央アジア', 'ヨーロッパ',
  'アフリカ', 'マダガスカル', '北アメリカ', '中央アメリカ', '南アメリカ', 'オセアニア', 'カリブ'];
const REDLIST = ['絶滅(EX)', '野生絶滅(EW)', '絶滅危惧IA類(CR)', '絶滅危惧IB類(EN)', '絶滅危惧II類(VU)',
  '準絶滅危惧(NT)', '低懸念(LC)', '情報不足(DD)', '評価対象外', 'ランク外'];

// エージェントが「該当区分がない」と報告してきた種を、正しい区分に直す
const REDLIST_FIX = {
  'incilius-periglenes': '絶滅(EX)',            // キンイロヒキガエル：絶滅
  'nectophrynoides-asperginis': '野生絶滅(EW)', // キハンシコモチヒキガエル：野生絶滅
};

const sizeBand = (max) =>
  max < 25 ? '超小型' : max < 50 ? '小型' : max < 90 ? '中型' : max < 150 ? '大型' : '超大型';

const warnings = [];
const errors = [];

const files = readdirSync(PARTS).filter((f) => f.endsWith('.json')).sort();
const byId = new Map();
const bySci = new Map();

for (const file of files) {
  let list;
  try {
    list = JSON.parse(readFileSync(join(PARTS, file), 'utf8'));
  } catch (err) {
    errors.push(`${file}: JSONとして読めません — ${err.message}`);
    continue;
  }
  if (!Array.isArray(list)) {
    errors.push(`${file}: 配列ではありません`);
    continue;
  }

  for (const raw of list) {
    const s = clean(raw, file);
    if (!s) continue;

    if (byId.has(s.id)) {
      warnings.push(`重複(id): ${s.id} — ${file} の方を捨てました`);
      continue;
    }
    const sciKey = s.nameSci.toLowerCase();
    if (bySci.has(sciKey)) {
      warnings.push(`重複(学名): ${s.nameSci} (${file}) — 先に登録された ${bySci.get(sciKey)} を残しました`);
      continue;
    }
    byId.set(s.id, s);
    bySci.set(sciKey, s.id);
  }
  console.log(`  ${file.padEnd(14)} ${String(list.length).padStart(3)}件`);
}

function clean(s, file) {
  const where = `${file}/${s?.id || s?.nameSci || '?'}`;
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

  const habitat = pick(t.habitat, HABITATS);
  if (!habitat.length) warnings.push(`${where}: habitat が不正 (${JSON.stringify(t.habitat)})`);

  const region = pick(t.region, REGIONS);
  if (!region.length) warnings.push(`${where}: region が不正 (${JSON.stringify(t.region)})`);

  const activity = pick(t.activity, ACTIVITIES);
  const origin = ORIGINS.includes(t.origin) ? t.origin : '国外';

  let redlist = REDLIST_FIX[s.id] || t.redlist;
  if (!REDLIST.includes(redlist)) {
    warnings.push(`${where}: redlist が不正 (${redlist}) → 情報不足(DD) にしました`);
    redlist = '情報不足(DD)';
  }

  const len = [...s.description].length;
  if (len < 40 || len > 220) warnings.push(`${where}: description が ${len}字`);

  return {
    id: s.id,
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
      size: sizeMm ? sizeBand(sizeMm[1]) : '',   // 体長から機械的に決め直す
      activity: activity.length ? activity : ['夜行性'],
      toxic: !!t.toxic,
      region,
      breeding: (t.breeding || '不明').trim(),
      redlist,
    },
    zooDisplay: !!s.zooDisplay,
  };
}

/* ---- 出力 ---- */

const out = [...byId.values()].sort((a, b) =>
  a.family.localeCompare(b.family, 'ja') || a.nameJa.localeCompare(b.nameJa, 'ja'));

writeFileSync(join(ROOT, 'data', 'frogs.json'), JSON.stringify(out, null, 1) + '\n', 'utf8');

/* ---- レポート ---- */

const count = (fn) => out.filter(fn).length;

console.log('\n=== frogs.json ===');
console.log(`合計            ${out.length}種`);
console.log(`  在来(日本)    ${count((s) => s.tags.origin === '在来')}種`);
console.log(`  外来(日本定着) ${count((s) => s.tags.origin === '外来')}種`);
console.log(`  国外          ${count((s) => s.tags.origin === '国外')}種`);
console.log(`  国内展示あり   ${count((s) => s.zooDisplay)}種`);
console.log(`  毒あり        ${count((s) => s.tags.toxic)}種`);
console.log(`  科の数        ${new Set(out.map((s) => s.family)).size}`);

if (warnings.length) {
  console.log(`\n--- 警告 ${warnings.length}件 ---`);
  for (const w of warnings) console.log('  ' + w);
}
if (errors.length) {
  console.log(`\n--- エラー ${errors.length}件 ---`);
  for (const e of errors) console.log('  ' + e);
  process.exitCode = 1;
}
