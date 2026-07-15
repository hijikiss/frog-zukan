/**
 * モーダルのフッター（登録ボタン）が、狭い表示領域でも画面内に収まって
 * タップ可能かを実測する。キーボードで visualViewport が縮んだ状況を、
 * 短いウィンドウ高で近似する。
 *
 *   node scripts/check-modal.mjs [url] [png]
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
const SHOT = process.argv[3] || null;
const PORT = 9444;
const W = 380, H = 470;              // 狭い表示領域（キーボードが出た状態の近似）

const exe = BROWSERS.find(existsSync);
const profile = mkdtempSync(join(tmpdir(), 'frog-modal-'));
const proc = spawn(exe, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });

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

  if (SHOT) {
    const img = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(SHOT, Buffer.from(img.data, 'base64'));
    console.log('screenshot →', SHOT);
  }

  const ok = rect.visible && rect.hitsButton;
  console.log(ok ? '\nOK: 登録ボタンは画面内にあり、タップが当たる' : '\nNG: 登録ボタンに届かない');
  process.exitCode = ok ? 0 : 1;
  ws.close();
} finally {
  proc.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* 使用中 */ }
}
