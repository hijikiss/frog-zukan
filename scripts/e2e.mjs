/**
 * 写真登録フローのエンドツーエンド確認。
 *
 *   1) python -m http.server 8765
 *   2) node scripts/e2e.mjs
 *
 * ヘッドレスブラウザで実際に
 *   EXIF付きJPEGを選ぶ → 野外で登録 → ステータスが「野生で観察」になる
 *   別の種を飼育展示で登録 → 施設別ページに出る
 *   エクスポート → 全消去 → インポートで復元
 * まで通す。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const BASE = process.argv[2] || 'http://localhost:8765/';
const SHOT_DIR = process.argv[3] || null;   // 指定すると要所でスクリーンショットを保存
const PORT = 9333;

const exe = BROWSERS.find(existsSync);
if (!exe) { console.error('Edge/Chrome が見つかりません'); process.exit(1); }

const profile = mkdtempSync(join(tmpdir(), 'frog-e2e-'));
const work = mkdtempSync(join(tmpdir(), 'frog-files-'));

const proc = spawn(exe, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=400,900', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`  NG  ${name} ${extra}`); }
};

/* ---------- CDP ---------- */

let msgId = 0;
const pending = new Map();
const errors = [];
let ws;

const send = (method, params = {}) => {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};

/** ページ内で式を評価（await 可） */
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  }
  return r.result.value;
}

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r) => { ws.onopen = r; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) {
            const { resolve, reject } = pending.get(m.id);
            pending.delete(m.id);
            m.error ? reject(new Error(m.error.message)) : resolve(m.result);
          } else if (m.method === 'Runtime.exceptionThrown') {
            errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
          } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
            errors.push((m.params.args || []).map((a) => a.value ?? a.description).join(' '));
          }
        };
        await send('Runtime.enable');
        await send('Page.enable');
        await send('DOM.enable');
        return;
      }
    } catch { /* 起動待ち */ }
    await sleep(250);
  }
  throw new Error('ブラウザに接続できません');
}

/** セレクタに一致する要素をクリック */
const click = (sel) => evalJs(`
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) throw new Error('見つかりません: ' + ${JSON.stringify(sel)});
  e.click(); return true;
`);

/** テキストが一致するボタンをクリック */
const clickText = (sel, text) => evalJs(`
  const e = [...document.querySelectorAll(${JSON.stringify(sel)})]
    .find(n => n.textContent.includes(${JSON.stringify(text)}));
  if (!e) throw new Error('見つかりません: ${text}');
  e.click(); return true;
`);

const setValue = (sel, value) => evalJs(`
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) throw new Error('見つかりません: ' + ${JSON.stringify(sel)});
  e.value = ${JSON.stringify(value)};
  e.dispatchEvent(new Event('input', {bubbles:true}));
  e.dispatchEvent(new Event('change', {bubbles:true}));
  return true;
`);

async function goto(hash) {
  await evalJs(`location.hash = ${JSON.stringify(hash)}; return true;`);
  await sleep(500);
}

async function screenshot(name) {
  if (!SHOT_DIR) return;
  const img = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOT_DIR, name), Buffer.from(img.data, 'base64'));
}

/** file input にファイルを流し込む */
async function setFile(sel, path) {
  const { result } = await send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(sel)})`,
  });
  await send('DOM.setFileInputFiles', { files: [path], objectId: result.objectId });
}

/* ---------- テスト用 JPEG（EXIF入り）を作る ---------- */

function withExif(jpegBytes, { date, lat, lng }) {
  const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
  const rat = (v) => [...u32(Math.round(v * 10000)), ...u32(10000)];

  const t = [];
  t.push(0x49, 0x49, ...u16(42), ...u32(8));

  const ifd0 = 8;
  const ifd0Size = 2 + 2 * 12 + 4;
  const exifIfd = ifd0 + ifd0Size;
  const exifSize = 2 + 1 * 12 + 4;
  const dateOff = exifIfd + exifSize;
  const dateBytes = [...Buffer.from(date + '\0', 'ascii')];
  const gpsIfd = dateOff + dateBytes.length;
  const gpsSize = 2 + 4 * 12 + 4;
  const latOff = gpsIfd + gpsSize;
  const lngOff = latOff + 24;

  t.push(...u16(2));
  t.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifIfd));
  t.push(...u16(0x8825), ...u16(4), ...u32(1), ...u32(gpsIfd));
  t.push(...u32(0));

  t.push(...u16(1));
  t.push(...u16(0x9003), ...u16(2), ...u32(dateBytes.length), ...u32(dateOff));
  t.push(...u32(0));
  t.push(...dateBytes);

  const dms = (deg) => {
    const a = Math.floor(Math.abs(deg));
    const m = Math.floor((Math.abs(deg) - a) * 60);
    const s = ((Math.abs(deg) - a) * 60 - m) * 60;
    return [a, m, s];
  };
  t.push(...u16(4));
  t.push(...u16(0x0001), ...u16(2), ...u32(2), (lat >= 0 ? 'N' : 'S').charCodeAt(0), 0, 0, 0);
  t.push(...u16(0x0002), ...u16(5), ...u32(3), ...u32(latOff));
  t.push(...u16(0x0003), ...u16(2), ...u32(2), (lng >= 0 ? 'E' : 'W').charCodeAt(0), 0, 0, 0);
  t.push(...u16(0x0004), ...u16(5), ...u32(3), ...u32(lngOff));
  t.push(...u32(0));
  for (const v of dms(lat)) t.push(...rat(v));
  for (const v of dms(lng)) t.push(...rat(v));

  const payload = [...Buffer.from('Exif\0\0', 'ascii'), ...t];
  const len = payload.length + 2;
  const app1 = Buffer.from([0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload]);

  // SOI の直後に APP1 を差し込む
  return Buffer.concat([jpegBytes.subarray(0, 2), app1, jpegBytes.subarray(2)]);
}

/* ---------- 本体 ---------- */

try {
  await connect();
  await send('Page.navigate', { url: BASE });
  await sleep(2500);

  console.log('起動');
  const total = await evalJs(`return document.querySelectorAll('.card').length;`);
  check('330種のカードが出る', total === 330, `(${total})`);

  // ブラウザで本物の JPEG を作り、Node 側で EXIF を差し込む
  const b64 = await evalJs(`
    const c = document.createElement('canvas');
    c.width = 640; c.height = 480;
    const x = c.getContext('2d');
    x.fillStyle = '#3a7d4f'; x.fillRect(0, 0, 640, 480);
    x.fillStyle = '#d9e8a0'; x.beginPath(); x.arc(320, 240, 120, 0, 7); x.fill();
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  `);
  const plain = Buffer.from(b64, 'base64');

  // 日光・中禅寺湖あたり
  const wildJpeg = join(work, 'wild.jpg');
  writeFileSync(wildJpeg, withExif(plain, { date: '2025:05:03 21:14:05', lat: 36.7333, lng: 139.4667 }));
  const captiveJpeg = join(work, 'captive.jpg');
  writeFileSync(captiveJpeg, withExif(plain, { date: '2025:06:21 13:40:00', lat: 35.7156, lng: 139.7745 }));

  /* ---- 1. 野外で登録 ---- */
  console.log('\n野外の写真を登録');
  await goto('#/s/rana-japonica');
  await setFile('input[type=file]', wildJpeg);
  await sleep(1500);

  const modalOpen = await evalJs(`return !!document.querySelector('.modal');`);
  check('写真エディタが開く', modalOpen);

  await screenshot('editor.png');

  const exifRead = await evalJs(`
    return {
      date: document.querySelector('input[type=datetime-local]')?.value,
      hint: [...document.querySelectorAll('.hint')].map(h => h.textContent).join(' | '),
    };
  `);
  check('EXIFの撮影日時が入る', exifRead.date === '2025-05-03T21:14', `(${exifRead.date})`);

  // シチュエーション未選択のままでは登録できないこと
  await clickText('.modal-foot .btn.primary', '登録');
  await sleep(300);
  const blocked = await evalJs(`return !!document.querySelector('.modal');`);
  check('シチュエーション未選択だと登録できない', blocked);

  await clickText('.segmented button', '野外');
  await sleep(200);

  const gps = await evalJs(`
    const t = document.querySelector('.field .hint span');
    return t ? t.textContent : '';
  `);
  check('EXIFのGPSが自動で入る', /36\.73/.test(gps) && /139\.46/.test(gps), `(${gps})`);

  await setValue('.field input[type=text]', '栃木県日光市 中禅寺湖畔');
  await evalJs(`
    document.querySelector('.modal textarea').value = '雨上がりの林道で。';
    return true;
  `);
  await clickText('.modal-foot .btn.primary', '登録');
  await sleep(1200);

  const afterWild = await evalJs(`
    return {
      closed: !document.querySelector('.modal'),
      progress: document.getElementById('progressText').textContent,
      status: document.querySelector('.statusline')?.textContent,
      photos: document.querySelectorAll('.photo-card').length,
      where: document.querySelector('.photo-meta .where')?.textContent,
      pill: document.querySelector('.pill')?.textContent,
    };
  `);
  check('モーダルが閉じる', afterWild.closed);
  check('写真が1枚登録される', afterWild.photos === 1, `(${afterWild.photos})`);
  check('ステータスが「野生で観察」', /野生で観察/.test(afterWild.status || ''), `(${afterWild.status})`);
  check('進捗が 1種 / 野生 1種 になる',
    /330種中 1種観察済み（うち野生 1種）/.test(afterWild.progress), `(${afterWild.progress})`);
  check('場所が写真カードに出る', afterWild.where === '栃木県日光市 中禅寺湖畔', `(${afterWild.where})`);
  check('野生バッジが付く', afterWild.pill === '野生', `(${afterWild.pill})`);
  await screenshot('detail-with-photo.png');

  /* ---- 2. 飼育展示で登録 ---- */
  console.log('\n飼育展示の写真を登録');
  await goto('#/s/dendrobates-tinctorius');
  await setFile('input[type=file]', captiveJpeg);
  await sleep(1500);
  await clickText('.segmented button', '飼育展示');
  await sleep(200);
  await setValue('.modal input[list=facility-options]', 'サンシャイン水族館');
  await clickText('.modal-foot .btn.primary', '登録');
  await sleep(1200);

  const afterCaptive = await evalJs(`
    return {
      progress: document.getElementById('progressText').textContent,
      status: document.querySelector('.statusline')?.textContent,
      where: document.querySelector('.photo-meta .where')?.textContent,
    };
  `);
  check('ステータスが「展示で観察」', /展示で観察/.test(afterCaptive.status || ''), `(${afterCaptive.status})`);
  check('進捗が 2種 / 野生 1種 になる',
    /330種中 2種観察済み（うち野生 1種）/.test(afterCaptive.progress), `(${afterCaptive.progress})`);
  check('施設名が写真カードに出る', afterCaptive.where === 'サンシャイン水族館', `(${afterCaptive.where})`);

  /* ---- 3. 施設別ページ ---- */
  console.log('\n施設別ページ');
  await goto('#/facilities');
  await sleep(600);
  const fac = await evalJs(`
    return {
      rows: [...document.querySelectorAll('.row .t')].map(e => e.textContent),
      sub: [...document.querySelectorAll('.row .s')].map(e => e.textContent),
    };
  `);
  check('施設が一覧に出る', fac.rows.includes('サンシャイン水族館'), JSON.stringify(fac.rows));
  check('野外の行も出る', fac.rows.includes('野外で観察したカエル'));
  check('施設の観察種数が出る', /1種/.test(fac.sub[0] || ''), `(${fac.sub[0]})`);
  await screenshot('facilities.png');

  await goto('#/f/' + encodeURIComponent('サンシャイン水族館'));
  await sleep(600);
  const facDetail = await evalJs(`
    return {
      title: document.querySelector('.panel h2')?.textContent,
      species: [...document.querySelectorAll('.card-ja')].map(e => e.textContent),
    };
  `);
  check('施設ページにここで観た種が出る',
    facDetail.species.includes('アイゾメヤドクガエル'), JSON.stringify(facDetail));

  /* ---- 4. 一覧のバッジ・絞り込み ---- */
  console.log('\n一覧のバッジと絞り込み');
  await goto('#/');
  await sleep(700);
  const badges = await evalJs(`
    return {
      wild: document.querySelectorAll('.badge.wild').length,
      captive: document.querySelectorAll('.badge.captive').length,
      covers: document.querySelectorAll('.card-img img').length,
    };
  `);
  check('一覧に野生バッジが1つ', badges.wild === 1, `(${badges.wild})`);
  check('一覧に展示バッジが1つ', badges.captive === 1, `(${badges.captive})`);
  check('自分の写真がカードのサムネになる', badges.covers === 2, `(${badges.covers})`);

  await click('.filter-toggle');
  await sleep(300);
  await screenshot('filters.png');
  await clickText('.filters .chip', '野生で観察');
  await sleep(400);
  const filtered = await evalJs(`
    return {
      count: document.querySelectorAll('.card').length,
      name: document.querySelector('.card-ja')?.textContent,
    };
  `);
  check('「野生で観察」で絞ると1種', filtered.count === 1, `(${filtered.count})`);
  check('絞り込み結果がニホンアカガエル', filtered.name === 'ニホンアカガエル', `(${filtered.name})`);

  /* ---- 5. エクスポート → 全消去 → インポート ---- */
  console.log('\nバックアップの往復');
  const roundTrip = await evalJs(`
    const backup = await import('./js/backup.js');
    const db = await import('./js/db.js');
    const sp = await import('./js/species.js');

    const blob = await backup.exportAll({ includePhotos: true });
    const size = blob.size;

    await db.photos.clear();
    await sp.refreshPhotoIndex();
    const afterClear = sp.progress();

    const file = new File([blob], 'backup.json', { type: 'application/json' });
    const res = await backup.importFile(file, { mode: 'merge' });
    await sp.refreshPhotoIndex();
    const afterImport = sp.progress();

    const all = await db.photos.all();
    const wild = all.find(p => p.context === 'wild');

    return {
      size,
      afterClear,
      afterImport,
      imported: res.photos,
      placeName: wild?.placeName,
      lat: wild?.lat,
      note: wild?.note,
      takenAt: wild?.takenAt,
      blobType: wild?.blob?.type,
      blobSize: wild?.blob?.size,
    };
  `);
  check('エクスポートに写真が入る（サイズ十分）', roundTrip.size > 20000, `(${roundTrip.size} bytes)`);
  check('全消去で0種に戻る', roundTrip.afterClear.observed === 0);
  check('インポートで写真が2枚戻る', roundTrip.imported === 2, `(${roundTrip.imported})`);
  check('インポート後に 2種 / 野生 1種',
    roundTrip.afterImport.observed === 2 && roundTrip.afterImport.wild === 1,
    JSON.stringify(roundTrip.afterImport));
  check('地名・メモ・GPS・撮影日時が復元される',
    roundTrip.placeName === '栃木県日光市 中禅寺湖畔'
    && roundTrip.note === '雨上がりの林道で。'
    && Math.abs(roundTrip.lat - 36.7333) < 0.01
    && roundTrip.takenAt.startsWith('2025-05-03'),
    JSON.stringify(roundTrip));
  check('画像そのものが復元される（JPEG blob）',
    roundTrip.blobType === 'image/jpeg' && roundTrip.blobSize > 5000,
    `(${roundTrip.blobType} ${roundTrip.blobSize}B)`);

  /* ---- 6. 種データの編集 ---- */
  console.log('\n種データの編集');
  const edit = await evalJs(`
    const sp = await import('./js/species.js');
    await sp.saveSpecies('rana-japonica', { nameEn: 'Japanese Brown Frog (edited)' });
    const after = sp.get('rana-japonica');
    return { nameEn: after.nameEn, nameJa: after.nameJa, edited: !!after._edited };
  `);
  check('種情報を編集できる', edit.nameEn === 'Japanese Brown Frog (edited)', JSON.stringify(edit));
  check('編集しても他のフィールドは残る', edit.nameJa === 'ニホンアカガエル');
  check('編集済みフラグが立つ', edit.edited);

  const reloaded = await evalJs(`
    const sp = await import('./js/species.js');
    await sp.load();                       // frogs.json を読み直しても編集が残るか
    return sp.get('rana-japonica').nameEn;
  `);
  check('再読み込み後も編集が残る', reloaded === 'Japanese Brown Frog (edited)', `(${reloaded})`);

  /* ---- 結果 ---- */
  console.log('\n--- コンソールエラー ---');
  if (!errors.length) console.log('  （なし）');
  for (const e of errors) console.log('  ' + e);

  console.log(`\n${passed} passed, ${failed} failed${errors.length ? `, ${errors.length} console errors` : ''}`);
  process.exitCode = failed || errors.length ? 1 : 0;

  ws.close();
} catch (err) {
  console.error('\n落ちました:', err.message);
  process.exitCode = 1;
} finally {
  proc.kill();
  await sleep(300);
  for (const d of [profile, work]) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* 使用中 */ }
  }
}
