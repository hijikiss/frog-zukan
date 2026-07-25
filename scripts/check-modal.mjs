/**
 * モーダルが狭い表示領域でも操作できるかを実測する。
 *
 *   1) フッター（登録ボタン）が画面内に収まりタップできるか
 *      （キーボードで visualViewport が縮んだ状況を、短いウィンドウ高で近似）
 *   2) 写真登録モーダルで、トリミング枠の下の入力欄（観察シチュエーション）に届くか
 *      枠は touch-action:none なので、枠が本文を覆い尽くすとスクロールもできなくなる
 *   3) visualViewport が一時的に小さい値を返しても、モーダルが縮まないか
 *      （iOS で写真選択シートが閉じた直後に起きる。掴むと本文が半分しか見えない）
 *
 *   node scripts/check-modal.mjs [url] [png]
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`  NG  ${name} ${extra}`); }
};

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const BASE = process.argv[2] || 'http://localhost:8765/';
const SHOT = process.argv[3] || null;
// 前回の残骸ブラウザに繋いでしまわないよう、実行ごとに違うポートを使う
const PORT = 9444 + (process.pid % 300);
const W = 380, H = 470;              // 狭い表示領域（キーボードが出た状態の近似）
const PHONE_W = 390, PHONE_H = 844;  // 写真登録モーダルの確認に使うスマホ相当の画面

const exe = BROWSERS.find(existsSync);
const profile = mkdtempSync(join(tmpdir(), 'frog-modal-'));
const work = mkdtempSync(join(tmpdir(), 'frog-modal-files-'));
const proc = spawn(exe, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });


/**
 * ブラウザを子プロセスごと終わらせる。
 * Windows では proc.kill() がランチャだけを落とすので、レンダラなどが残って
 * デバッグポートを掴み続け、次回の実行が「前回のブラウザ」に繋がってしまう。
 */
function killBrowser(p) {
  if (process.platform === 'win32') {
    try { spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* もう居ない */ }
  }
  try { p.kill(); } catch { /* もう居ない */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let msgId = 0;
const pending = new Map();
let ws;
const send = (method, params = {}) => {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
};
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

try {
  for (let i = 0; i < 40 && !ws; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r) => { ws.onopen = r; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
        };
        await send('Runtime.enable');
        await send('Page.enable');
        await send('DOM.enable');
      }
    } catch { await sleep(250); }
  }

  await send('Page.navigate', { url: BASE });
  await sleep(2500);
  await evalJs(`location.hash = '#/s/rana-japonica'; return 1;`);
  await sleep(600);

  // 実際の写真エディタをファイル無しで開く代わりに、同じ modal() を使った
  // フッター付きモーダルを出して、狭い画面でのボタン到達性を測る。
  await evalJs(`
    const { modal, el } = await import('./js/ui.js');
    const long = el('div');
    for (let i = 0; i < 20; i++) long.append(el('p', { text: '入力欄がたくさんある長いフォームの想定 ' + i }));
    window.__m = modal({
      title: '写真を登録',
      body: long,
      footer: [ el('button', { class: 'btn' }, 'キャンセル'), el('button', { class: 'btn primary', id: '__save' }, '登録') ],
    });
    return 1;
  `);
  await sleep(500);   // 登場アニメーション（.22s）が終わって位置が確定するのを待つ

  const rect = await evalJs(`
    const btn = document.getElementById('__save');
    const back = document.querySelector('.modal-backdrop');
    const r = btn.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const vv = window.visualViewport;
    const modalEl = document.querySelector('.modal');
    const bodyEl = document.querySelector('.modal-body');
    const mr = modalEl.getBoundingClientRect();
    return {
      modalTop: Math.round(mr.top), modalBottom: Math.round(mr.bottom), modalH: Math.round(mr.height),
      bodyMinHeight: getComputedStyle(bodyEl).minHeight,
      bodyScrolls: bodyEl.scrollHeight > bodyEl.clientHeight,
      modalMaxH: getComputedStyle(modalEl).maxHeight,
      innerH: window.innerHeight,
      dvh: getComputedStyle(document.documentElement).getPropertyValue('height'),
      vvHeight: vv ? Math.round(vv.height) : null,
      vvOffsetTop: vv ? Math.round(vv.offsetTop) : null,
      backTop: Math.round(back.getBoundingClientRect().top),
      backHeight: Math.round(back.getBoundingClientRect().height),
      btnTop: Math.round(r.top), btnBottom: Math.round(r.bottom),
      visible: r.bottom <= window.innerHeight && r.top >= 0,
      hitsButton: !!(top && (top === btn || btn.contains(top))),
      label: top ? top.textContent : null,
    };
  `);

  console.log('狭い画面（%dx%d）でのモーダル下部:', W, H);
  console.log(JSON.stringify(rect, null, 2));
  console.log('');
  check('登録ボタンが画面内にある', rect.visible, JSON.stringify([rect.btnTop, rect.btnBottom]));
  check('登録ボタンにタップが当たる', rect.hitsButton, String(rect.label));

  if (SHOT) {
    const img = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(SHOT, Buffer.from(img.data, 'base64'));
    console.log('screenshot →', SHOT);
  }

  await evalJs(`window.__m.close(); return 1;`);
  await sleep(200);

  /* ---- 写真登録モーダルで、トリミング枠の下の入力欄に届くか ---- */
  console.log('\n写真登録モーダル（%dx%d = スマホ相当）', PHONE_W, PHONE_H);
  await send('Emulation.setDeviceMetricsOverride', {
    width: PHONE_W, height: PHONE_H, deviceScaleFactor: 1, mobile: true,
  });
  await sleep(400);

  // スマホで撮った縦長写真の想定
  const b64 = await evalJs(`
    const c = document.createElement('canvas'); c.width = 900; c.height = 1600;
    const x = c.getContext('2d');
    x.fillStyle = '#3a7'; x.fillRect(0, 0, 900, 1600);
    x.fillStyle = '#fff'; x.fillRect(300, 700, 300, 200);
    return c.toDataURL('image/jpeg', 0.8).split(',')[1];
  `);
  const photo = join(work, 'photo.jpg');
  writeFileSync(photo, Buffer.from(b64, 'base64'));

  await evalJs(`location.hash = '#/s/rana-japonica'; return 1;`);
  await sleep(900);
  const { result: fileInput } = await send('Runtime.evaluate', {
    expression: `document.querySelector('input[type=file]')`,
  });
  await send('DOM.setFileInputFiles', { files: [photo], objectId: fileInput.objectId });
  await sleep(2200);

  const editor = await evalJs(`
    const body = document.querySelector('.modal-body');
    const frame = document.querySelector('.crop-frame');
    const seg = document.querySelector('.segmented');
    if (!body || !frame || !seg) throw new Error('写真登録モーダルが開いていません');

    const bodyR = body.getBoundingClientRect();
    const frameR = frame.getBoundingClientRect();
    const segR = seg.getBoundingClientRect();

    // 本文の見えている範囲のうち、touch-action:none の枠が覆っている高さ
    const covered = Math.max(0, Math.min(bodyR.bottom, frameR.bottom) - Math.max(bodyR.top, frameR.top));

    // 「野外」ボタンの中心にタップが当たるか（隠れていない・重なっていない）
    const wild = seg.querySelector('button');
    const wr = wild.getBoundingClientRect();
    const hit = document.elementFromPoint(wr.left + wr.width / 2, wr.top + wr.height / 2);

    // 横方向。overflow-y:auto だけだと overflow-x も auto 扱いになり、
    // 中身がわずかでもはみ出すと横に動いてしまう
    body.scrollLeft = 999;
    const scrolledLeft = body.scrollLeft;
    body.scrollLeft = 0;

    return {
      bodyVisibleH: Math.round(bodyR.height),
      frameH: Math.round(frameR.height),
      frameCoversPct: Math.round(covered / bodyR.height * 100),
      scrollStartableH: Math.round(bodyR.height - covered),
      segVisible: segR.top >= bodyR.top && segR.bottom <= bodyR.bottom,
      segHit: !!(hit && wild.contains(hit)),
      overflowX: getComputedStyle(body).overflowX,
      scrolledLeft,
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
    };
  `);
  console.log(JSON.stringify(editor, null, 2));
  console.log('');
  check('観察シチュエーションが最初から見えている', editor.segVisible, JSON.stringify(editor));
  check('観察シチュエーションにタップが当たる', editor.segHit);
  check('枠が本文を覆い尽くさない（スクロールを始められる）',
    editor.frameCoversPct <= 75 && editor.scrollStartableH >= 150,
    `(枠が${editor.frameCoversPct}% / 余白${editor.scrollStartableH}px)`);
  check('本文が横スクロールしない', editor.scrolledLeft === 0 && editor.overflowX === 'hidden',
    `(scrollLeft=${editor.scrolledLeft} overflow-x=${editor.overflowX})`);
  check('ページ自体も横に伸びていない', editor.docScrollW <= editor.docClientW,
    `(${editor.docScrollW} / ${editor.docClientW})`);

  if (SHOT) {
    const img = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(SHOT.replace(/\.png$/, '-editor.png'), Buffer.from(img.data, 'base64'));
  }

  await evalJs(`document.querySelector('.modal-head .x').click(); return 1;`);
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(300);

  /* ---- visualViewport が一時的に小さい値を返す状況 ---- */
  // iOS では写真選択シートが閉じた直後などに起きる。これを掴んで背景を縮めると
  // モーダルが画面の半分ほどで固まり、本文がほとんど見えなくなる。
  console.log('\nvisualViewport が実際より小さい値を返すとき');
  const stale = await evalJs(`
    const real = window.visualViewport;
    const fake = {
      height: Math.round(window.innerHeight * 0.55),   // 半分ほどの古い値
      offsetTop: 0,
      addEventListener() {}, removeEventListener() {},
    };
    Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });

    const { modal, el } = await import('./js/ui.js');
    const form = el('div');
    for (let i = 0; i < 20; i++) form.append(el('p', { text: '長いフォーム ' + i }));
    const input = el('input', { type: 'text', id: '__typed' });
    form.append(input);
    const m = modal({ title: '写真を登録', body: form, footer: [el('button', { class: 'btn primary' }, '登録')] });

    const back = document.querySelector('.modal-backdrop');
    const idle = Math.round(back.getBoundingClientRect().height);

    // 入力欄にフォーカス（＝キーボードが出た状態）なら、縮めて追従してよい
    input.focus();
    window.dispatchEvent(new Event('resize'));
    document.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const typing = Math.round(back.getBoundingClientRect().height);

    input.blur();
    document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    const afterBlur = Math.round(back.getBoundingClientRect().height);

    m.close();
    Object.defineProperty(window, 'visualViewport', { value: real, configurable: true });
    return { innerH: window.innerHeight, fakeH: fake.height, idle, typing, afterBlur };
  `);
  console.log(JSON.stringify(stale, null, 2));
  console.log('');
  check('入力していないときは縮まない', stale.idle >= stale.innerH - 2, `(${stale.idle} / ${stale.innerH})`);
  check('入力中はキーボードに合わせて縮む', Math.abs(stale.typing - stale.fakeH) <= 2, `(${stale.typing} / ${stale.fakeH})`);
  check('入力を終えると元に戻る', stale.afterBlur >= stale.innerH - 2, `(${stale.afterBlur} / ${stale.innerH})`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
  ws.close();
} finally {
  killBrowser(proc);
  await sleep(300);
  for (const d of [profile, work]) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* 使用中 */ }
  }
}
