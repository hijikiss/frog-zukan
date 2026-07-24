/**
 * cropper.js の実挙動テスト。
 *   1) python -m http.server 8765
 *   2) node scripts/crop-test.mjs
 *
 * 左半分=赤・右半分=青の横長画像(400x200)をトリミングし、
 *   ・出力が正方形か
 *   ・トリミング位置(cx)を変えると中身が変わるか（左寄せ→赤、右寄せ→青）
 *   ・拡大(z)で表示範囲が狭まるか
 * をレンダー結果のピクセルで検証する。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const BASE = process.argv[2] || 'http://localhost:8765/';
const PORT = 9555;

const exe = BROWSERS.find(existsSync);
const profile = mkdtempSync(join(tmpdir(), 'frog-crop-'));
const proc = spawn(exe, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=420,900', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let msgId = 0; const pending = new Map(); let ws;
const send = (method, params = {}) => { const id = ++msgId; ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => pending.set(id, { res, rej })); };
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => { if (cond) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.log(`  NG  ${name} ${extra}`); } };

try {
  for (let i = 0; i < 40 && !ws; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } }; await send('Runtime.enable'); }
    } catch { await sleep(250); }
  }
  await send('Page.navigate', { url: BASE });
  await sleep(2000);

  const result = await evalJs(`
    const { createCropper } = await import('./js/cropper.js');

    // 400x200 左半分=赤(255,0,0) 右半分=青(0,0,255)
    const c = document.createElement('canvas'); c.width = 400; c.height = 200;
    const x = c.getContext('2d');
    x.fillStyle = 'rgb(255,0,0)'; x.fillRect(0, 0, 200, 200);
    x.fillStyle = 'rgb(0,0,255)'; x.fillRect(200, 0, 200, 200);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));

    // レンダー結果の指定位置の色を返すヘルパー
    async function sample(cropParams, points) {
      const cr = await createCropper({ blob, crop: cropParams });
      document.body.append(cr.element);        // ResizeObserver 用に一応 DOM へ
      const out = await cr.render(200);
      const url = URL.createObjectURL(out);
      const im = new Image(); await new Promise(r => { im.onload = r; im.src = url; });
      const cc = document.createElement('canvas'); cc.width = 200; cc.height = 200;
      const cx = cc.getContext('2d'); cx.drawImage(im, 0, 0);
      const cols = points.map(([px, py]) => {
        const d = cx.getImageData(px, py, 1, 1).data;
        return d[0] > 150 && d[2] < 100 ? 'red' : d[2] > 150 && d[0] < 100 ? 'blue' : 'mix';
      });
      cr.element.remove(); cr.destroy(); URL.revokeObjectURL(url);
      return { w: out.type, square: im.naturalWidth === im.naturalHeight, size: im.naturalWidth, cols };
    }

    return {
      // 既定(中央・等倍): 2:1画像の中央正方形 → 左が赤・右が青
      center: await sample(null, [[40,100],[160,100]]),
      // 左に寄せて拡大 → 全面赤
      left:   await sample({ cx: 0.25, cy: 0.5, z: 2 }, [[100,100],[30,100],[170,100]]),
      // 右に寄せて拡大 → 全面青
      right:  await sample({ cx: 0.75, cy: 0.5, z: 2 }, [[100,100],[30,100],[170,100]]),
    };
  `);

  console.log('cropper.js');
  console.log('  center:', JSON.stringify(result.center));
  console.log('  left  :', JSON.stringify(result.left));
  console.log('  right :', JSON.stringify(result.right));
  console.log('');

  check('出力は正方形', result.center.square && result.left.square, JSON.stringify([result.center.size, result.left.size]));
  check('出力は JPEG', result.center.w === 'image/jpeg', result.center.w);
  check('等倍・中央: 左半分が赤', result.center.cols[0] === 'red', result.center.cols[0]);
  check('等倍・中央: 右半分が青', result.center.cols[1] === 'blue', result.center.cols[1]);
  check('左寄せ+拡大: 全面が赤', result.left.cols.every((c) => c === 'red'), JSON.stringify(result.left.cols));
  check('右寄せ+拡大: 全面が青', result.right.cols.every((c) => c === 'blue'), JSON.stringify(result.right.cols));

  /* ---- ピンチ操作（スマホ）---- */

  const touch = await evalJs(`
    const { createCropper } = await import('./js/cropper.js');

    const c = document.createElement('canvas'); c.width = 800; c.height = 800;
    const x = c.getContext('2d'); x.fillStyle = '#777'; x.fillRect(0, 0, 800, 800);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));

    const cr = await createCropper({ blob });
    cr.element.style.width = '300px';
    document.body.append(cr.element);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const frame = cr.element.querySelector('.crop-frame');
    const r = frame.getBoundingClientRect();
    const mx = r.left + r.width / 2, my = r.top + r.height / 2;
    const pt = (type, id, px, py) => frame.dispatchEvent(new PointerEvent(type, {
      pointerId: id, clientX: px, clientY: py, pointerType: 'touch', bubbles: true, cancelable: true,
    }));

    // 枠の中心で 2本指を 80px → 160px に開く（= 2倍）
    const z0 = cr.getCrop().z;
    pt('pointerdown', 1, mx - 40, my); pt('pointerdown', 2, mx + 40, my);
    pt('pointermove', 1, mx - 80, my); pt('pointermove', 2, mx + 80, my);
    const afterPinch = cr.getCrop();
    pt('pointerup', 1, mx - 80, my);   pt('pointerup', 2, mx + 80, my);

    // iOS の gesture イベント（合成）。scale はジェスチャ開始からの倍率。
    const gesture = (type, scale) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'scale', { value: scale });
      frame.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    const zBeforeGesture = cr.getCrop().z;
    const gestureBlocked = gesture('gesturestart', 1);
    gesture('gesturechange', 1.5);
    const afterGesture = cr.getCrop();
    gesture('gestureend', 1.5);

    // 1本指ドラッグ（右へ動かすと、見えている範囲は左へ寄る）
    const beforeDrag = cr.getCrop();
    pt('pointerdown', 3, mx, my);
    pt('pointermove', 3, mx + 30, my);
    pt('pointerup', 3, mx + 30, my);
    const afterDrag = cr.getCrop();

    // ホイール（カーソル位置を基準に拡大する）
    const beforeWheel = cr.getCrop();
    frame.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -100, clientX: r.left + r.width * 0.25, clientY: my, bubbles: true, cancelable: true,
    }));
    const afterWheel = cr.getCrop();

    // ページ側のピンチ（枠の外）が止まるか
    const touchEv = (n) => {
      const touches = Array.from({ length: n }, (_, i) => new Touch({
        identifier: i, target: document.body, clientX: 100 + i * 40, clientY: 300,
      }));
      const ev = new TouchEvent('touchmove', {
        bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: touches,
      });
      document.body.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    const twoFinger = touchEv(2);
    const oneFinger = touchEv(1);

    cr.element.remove();
    cr.destroy();
    const twoFingerAfterDestroy = touchEv(2);

    return {
      z0, afterPinch, zBeforeGesture, afterGesture, beforeDrag, afterDrag, beforeWheel, afterWheel,
      gestureBlocked, twoFinger, oneFinger, twoFingerAfterDestroy,
    };
  `);

  console.log('ピンチ操作');
  console.log('  pinch  :', JSON.stringify(touch.afterPinch));
  console.log('  gesture:', JSON.stringify(touch.afterGesture), `(開始時 z=${touch.zBeforeGesture})`);
  console.log('');

  check('2本指を開くと拡大される', Math.abs(touch.afterPinch.z - touch.z0 * 2) < 0.1, `z=${touch.afterPinch.z}`);
  check('枠の中心でピンチしても中心はほぼ動かない',
    Math.abs(touch.afterPinch.cx - 0.5) < 0.05 && Math.abs(touch.afterPinch.cy - 0.5) < 0.05,
    JSON.stringify([touch.afterPinch.cx, touch.afterPinch.cy]));
  check('1本指ドラッグで位置が動く', touch.afterDrag.cx < touch.beforeDrag.cx - 0.02,
    JSON.stringify([touch.beforeDrag.cx, touch.afterDrag.cx]));
  check('ホイールはカーソル位置を基準に拡大する',
    touch.afterWheel.z > touch.beforeWheel.z && touch.afterWheel.cx < touch.beforeWheel.cx,
    JSON.stringify([touch.beforeWheel, touch.afterWheel]));
  check('iOS の gesturestart はページ拡大を止める', touch.gestureBlocked === true);
  check('gesturechange の scale で拡大される',
    Math.abs(touch.afterGesture.z - touch.zBeforeGesture * 1.5) < 0.1, `z=${touch.afterGesture.z}`);
  check('枠の外でも2本指はページに渡さない', touch.twoFinger === true);
  check('1本指のスクロールは妨げない', touch.oneFinger === false);
  check('destroy 後は抑止を解除する', touch.twoFingerAfterDestroy === false);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
  ws.close();
} catch (err) {
  console.error('落ちました:', err.message);
  process.exitCode = 1;
} finally {
  proc.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* 使用中 */ }
}
