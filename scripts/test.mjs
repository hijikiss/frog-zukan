/**
 * ブラウザなしで検証できる部分のテスト。
 *   node scripts/test.mjs
 *
 * - exif.js: 合成した JPEG から撮影日時と GPS を読めるか
 * - species.js: 検索・絞り込み・サイズ帯
 * - frogs.json: 全レコードがスキーマを満たすか
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.log(`  NG  ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
};

/* ============ EXIF ============ */

const { parseExif } = await import('../js/exif.js');

/** DateTimeOriginal と GPS を持つ最小の JPEG を組み立てる（little endian TIFF） */
function makeJpeg({ date = '2025:07:14 18:03:22', lat = [35, 41, 22.8], lng = [139, 45, 15.6], latRef = 'N', lngRef = 'E' } = {}) {
  const chunks = [];
  const tiff = [];             // TIFF ブロック（オフセットは TIFF 先頭からの相対）
  const push = (arr, ...bytes) => arr.push(...bytes);

  const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
  const rational = (num, den) => [...u32(num), ...u32(den)];

  // ヘッダ: II 42 offset(8)
  push(tiff, 0x49, 0x49, ...u16(42), ...u32(8));

  // IFD0: 2 エントリ（ExifIFD, GPSIFD）
  const ifd0Start = 8;
  const ifd0Size = 2 + 2 * 12 + 4;
  const exifIfdOffset = ifd0Start + ifd0Size;

  // Exif IFD: 1 エントリ（DateTimeOriginal） + データ
  const exifIfdSize = 2 + 1 * 12 + 4;
  const dateOffset = exifIfdOffset + exifIfdSize;
  const dateBytes = [...Buffer.from(date + '\0', 'ascii')];

  const gpsIfdOffset = dateOffset + dateBytes.length;
  const gpsIfdSize = 2 + 4 * 12 + 4;
  const latOffset = gpsIfdOffset + gpsIfdSize;
  const lngOffset = latOffset + 24;

  // --- IFD0 ---
  push(tiff, ...u16(2));
  push(tiff, ...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifIfdOffset)); // ExifIFDPointer
  push(tiff, ...u16(0x8825), ...u16(4), ...u32(1), ...u32(gpsIfdOffset));  // GPSIFDPointer
  push(tiff, ...u32(0));

  // --- Exif IFD ---
  push(tiff, ...u16(1));
  push(tiff, ...u16(0x9003), ...u16(2), ...u32(dateBytes.length), ...u32(dateOffset));
  push(tiff, ...u32(0));
  push(tiff, ...dateBytes);

  // --- GPS IFD ---
  push(tiff, ...u16(4));
  push(tiff, ...u16(0x0001), ...u16(2), ...u32(2), latRef.charCodeAt(0), 0, 0, 0);
  push(tiff, ...u16(0x0002), ...u16(5), ...u32(3), ...u32(latOffset));
  push(tiff, ...u16(0x0003), ...u16(2), ...u32(2), lngRef.charCodeAt(0), 0, 0, 0);
  push(tiff, ...u16(0x0004), ...u16(5), ...u32(3), ...u32(lngOffset));
  push(tiff, ...u32(0));

  // 度分秒（秒は 1/100 単位の分数で表現）
  for (const v of lat) push(tiff, ...rational(Math.round(v * 100), 100));
  for (const v of lng) push(tiff, ...rational(Math.round(v * 100), 100));

  // JPEG: SOI + APP1(Exif) + EOI
  const app1Payload = [...Buffer.from('Exif\0\0', 'ascii'), ...tiff];
  const app1Len = app1Payload.length + 2;
  push(chunks, 0xff, 0xd8);
  push(chunks, 0xff, 0xe1, (app1Len >> 8) & 0xff, app1Len & 0xff, ...app1Payload);
  push(chunks, 0xff, 0xd9);

  return new Uint8Array(chunks).buffer;
}

console.log('exif.js');

test('DateTimeOriginal を読める', () => {
  const r = parseExif(makeJpeg());
  assert.ok(r, 'EXIF が null');
  const d = r.dateTimeOriginal;
  assert.equal(d.getFullYear(), 2025);
  assert.equal(d.getMonth() + 1, 7);
  assert.equal(d.getDate(), 14);
  assert.equal(d.getHours(), 18);
  assert.equal(d.getMinutes(), 3);
});

test('GPS を十進度に変換できる（北緯・東経）', () => {
  const r = parseExif(makeJpeg());
  assert.ok(Math.abs(r.lat - 35.689667) < 0.001, `lat=${r.lat}`);
  assert.ok(Math.abs(r.lng - 139.754333) < 0.001, `lng=${r.lng}`);
});

test('南緯・西経は負になる', () => {
  const r = parseExif(makeJpeg({ latRef: 'S', lngRef: 'W' }));
  assert.ok(r.lat < 0 && r.lng < 0, `lat=${r.lat} lng=${r.lng}`);
});

test('EXIF が無い / 壊れていても落ちない', () => {
  assert.equal(parseExif(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer), null);
  assert.equal(parseExif(new Uint8Array([1, 2, 3]).buffer), null);
  assert.equal(parseExif(new ArrayBuffer(0)), null);
});

/* ============ 種データ（全グループ） ============ */

console.log('\ndata/species/*.json');

const { GROUPS, sizeBand, ORIGINS, ACTIVITIES, REGIONS, REDLIST } = await import('../js/groups.js');

const byGroup = new Map();
for (const g of GROUPS) {
  byGroup.set(g.id, JSON.parse(readFileSync(join(ROOT, 'data', 'species', `${g.id}.json`), 'utf8')));
}
const allSpecies = [...byGroup.values()].flat();
const frogs = byGroup.get('frog');

test('全グループのデータファイルが存在し、空でない', () => {
  for (const g of GROUPS) {
    assert.ok(byGroup.get(g.id).length > 0, `${g.name} が0種`);
  }
});

test('カエルは300種以上ある', () => {
  assert.ok(frogs.length >= 300, `${frogs.length}種しかない`);
});

test('カエルの日本の在来種・外来種が45種以上ある', () => {
  const jp = frogs.filter((s) => ['在来', '外来'].includes(s.tags.origin));
  assert.ok(jp.length >= 45, `${jp.length}種`);
});

test('国内で展示されやすい種が100種以上ある', () => {
  assert.ok(allSpecies.filter((s) => s.zooDisplay).length >= 100);
});

test('id と学名が全グループを通して一意', () => {
  assert.equal(new Set(allSpecies.map((s) => s.id)).size, allSpecies.length, 'id が重複');
  assert.equal(new Set(allSpecies.map((s) => s.nameSci)).size, allSpecies.length, '学名が重複');
});

test('全レコードが必須フィールドとタグを持つ', () => {
  for (const s of allSpecies) {
    for (const k of ['id', 'nameJa', 'nameSci', 'family', 'description']) {
      assert.ok(s[k], `${s.id}: ${k} が空`);
    }
    assert.ok(Array.isArray(s.sizeMm) && s.sizeMm[0] <= s.sizeMm[1], `${s.id}: sizeMm`);
    const t = s.tags;
    assert.ok(t.habitat.length, `${s.id}: habitat`);
    assert.ok(t.region.length, `${s.id}: region`);
    assert.ok(t.activity.length, `${s.id}: activity`);
    assert.equal(typeof t.toxic, 'boolean', `${s.id}: toxic`);
    assert.ok(t.redlist, `${s.id}: redlist`);
  }
});

test('タグの語彙がグループの定義から外れていない', () => {
  for (const g of GROUPS) {
    for (const s of byGroup.get(g.id)) {
      assert.equal(s.group, g.id, `${s.id}: group が ${s.group}`);
      for (const h of s.tags.habitat) {
        assert.ok(g.habitats.includes(h), `${s.id}: ${g.name} に無い生息環境 ${h}`);
      }
      for (const r of s.tags.region) assert.ok(REGIONS.includes(r), `${s.id}: 分布 ${r}`);
      for (const a of s.tags.activity) assert.ok(ACTIVITIES.includes(a), `${s.id}: 活動時間 ${a}`);
      assert.ok(ORIGINS.includes(s.tags.origin), `${s.id}: 在来区分 ${s.tags.origin}`);
      assert.ok(REDLIST.includes(s.tags.redlist), `${s.id}: レッドリスト ${s.tags.redlist}`);
      if (!g.toxic.show) assert.equal(s.tags.toxic, false, `${s.id}: ${g.name} に毒フラグ`);
    }
  }
});

test('日本の代表種が各グループに入っている', () => {
  const need = {
    frog: 'ニホンアマガエル',
    newt: 'アカハライモリ',
    salamander: 'オオサンショウウオ',
    snake: 'アオダイショウ',
    turtle: 'ニホンイシガメ',
    gecko: 'ニホンヤモリ',
    lizard: 'ニホンカナヘビ',
    croc: 'イリエワニ',
  };
  for (const [gid, name] of Object.entries(need)) {
    assert.ok(byGroup.get(gid).some((s) => s.nameJa === name), `${gid}: ${name} が無い`);
  }
});

/* ============ species.js ============ */

console.log('\nspecies.js');

const sp = await import('../js/species.js');

test('サイズ帯を体長から判定できる（カエルの基準）', () => {
  assert.equal(sp.sizeBand(20, 'frog'), '超小型');
  assert.equal(sp.sizeBand(40, 'frog'), '小型');
  assert.equal(sp.sizeBand(70, 'frog'), '中型');
  assert.equal(sp.sizeBand(120, 'frog'), '大型');
  assert.equal(sp.sizeBand(300, 'frog'), '超大型');
});

test('サイズ帯の基準はグループごとに違う', () => {
  // 1m はカエルなら超大型だが、ヘビなら中型・ワニなら超小型
  assert.equal(sp.sizeBand(1000, 'frog'), '超大型');
  assert.equal(sp.sizeBand(1000, 'snake'), '中型');
  assert.equal(sp.sizeBand(1000, 'croc'), '超小型');
  assert.equal(sp.sizeBand(150, 'turtle'), '小型');
});

test('sizeMm とサイズ帯タグが全種で整合する', () => {
  for (const s of allSpecies) {
    assert.equal(s.tags.size, sizeBand(s.sizeMm[1], s.group), `${s.id} (${s.sizeMm[1]}mm/${s.group})`);
  }
});

test('グループで絞れる', () => {
  assert.equal(sp.all('snake').length, 0, '読み込み前は空');   // load() 前なので全体は空
  const snakes = byGroup.get('snake');
  assert.ok(snakes.every((s) => s.group === 'snake'));
});

test('ひらがなで検索してもカタカナの和名・科名に当たる', () => {
  // 「あまがえる」→ 和名に「アマガエル」を含む種、または科が「アマガエル科」の種
  const hit = sp.search(frogs, 'あまがえる');
  assert.ok(hit.length > 5, `${hit.length}件`);
  assert.ok(hit.every((s) => s.nameJa.includes('アマガエル') || s.family.includes('アマガエル')),
    hit.filter((s) => !s.nameJa.includes('アマガエル') && !s.family.includes('アマガエル'))
      .map((s) => s.nameJa).join(', '));
  assert.ok(hit.some((s) => s.nameJa === 'ニホンアマガエル'), 'ニホンアマガエルが出ない');
});

test('複数語の AND 検索ができる', () => {
  const hit = sp.search(frogs, 'ヤドクガエル アイゾメ');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].nameJa, 'アイゾメヤドクガエル');
});

test('学名・英名でも検索できる', () => {
  assert.ok(sp.search(frogs, 'Dendrobates').length >= 4);
  assert.ok(sp.search(frogs, 'poison').length >= 3);
});

test('タグで絞り込める', () => {
  const toxic = sp.filter(frogs, { habitat: [], origin: [], size: [], activity: [], region: [], redlist: [], family: [], status: [], toxic: true, zooDisplay: false });
  assert.ok(toxic.length > 50 && toxic.every((s) => s.tags.toxic));

  const jpTree = sp.filter(frogs, { habitat: ['樹上棲'], origin: ['在来'], size: [], activity: [], region: [], redlist: [], family: [], status: [], toxic: null, zooDisplay: false });
  assert.ok(jpTree.length >= 5, `${jpTree.length}件`);
  assert.ok(jpTree.every((s) => s.tags.origin === '在来' && s.tags.habitat.includes('樹上棲')));
});

test('写真が無い状態では全種が未観察', () => {
  assert.equal(sp.statusOf('rana-japonica'), 'unseen');
});

console.log(`\n${passed} passed${process.exitCode ? '（失敗あり）' : ''}`);
