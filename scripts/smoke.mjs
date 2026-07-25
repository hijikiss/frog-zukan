/**
 * ブラウザでの動作確認（スモークテスト）。
 *
 *   1) python -m http.server 8765   （別ターミナルで）
 *   2) node scripts/smoke.mjs [パス] [出力png]
 *
 * ヘッドレス Edge/Chrome を CDP で操作し、コンソールエラーを拾ってスクリーンショットを撮る。
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const url = process.argv[2] || 'http://localhost:8765/';
const shot = process.argv[3] || null;
// 前回の残骸ブラウザに繋いでしまわないよう、実行ごとに違うポートを使う
const PORT = 9222 + (process.pid % 300);

const profile = mkdtempSync(join(tmpdir(), 'frog-smoke-'));
const exe = BROWSERS.find((p) => existsSync(p));
if (!exe) { console.error('Edge/Chrome が見つかりません'); process.exit(1); }

const proc = spawn(exe, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=400,900',
  'about:blank',
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

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* まだ起動中 */ }
    await sleep(250);
  }
  throw new Error('ブラウザに接続できませんでした');
}

let msgId = 0;
const pending = new Map();
const logs = [];

function send(ws, method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

try {
  const page = await targets();
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  await new Promise((r) => { ws.onopen = r; });

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      logs.push({ level: m.params.type, text });
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push({
        level: 'exception',
        text: `${d.exception?.description || d.text} @ ${d.url || ''}:${d.lineNumber}`,
      });
    }
    if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error' || e.level === 'warning') {
        logs.push({ level: e.level, text: `${e.text} ${e.url || ''}` });
      }
    }
  };

  await send(ws, 'Runtime.enable');
  await send(ws, 'Log.enable');
  await send(ws, 'Page.enable');

  await send(ws, 'Page.navigate', { url });

  // 種データの読み込みが終わるまで待つ。固定待ちだと、公開サイト相手のときに
  // 読み込み途中の画面を見てしまう（ローカルより通信が遅いため）。
  let waited = 0;
  for (; waited < 30000; waited += 500) {
    const r = await send(ws, 'Runtime.evaluate', {
      expression: `!!document.querySelector('.home-tile') || !!document.querySelector('.empty-state')`,
      returnByValue: true,
    });
    if (r.result.value) break;
    await sleep(500);
  }
  await sleep(500);
  console.log(`読み込み待ち: ${(waited / 1000).toFixed(1)}秒\n`);

  // 画面の状態を取り出す
  const probe = await send(ws, 'Runtime.evaluate', {
    expression: `JSON.stringify({
      progress: document.getElementById('progressText')?.textContent,
      tiles: [...document.querySelectorAll('.home-tile .home-name')].map(e => e.textContent),
      cards: document.querySelectorAll('.card').length,
      tabs: [...document.querySelectorAll('.tab')].map(t => t.textContent),
      title: document.getElementById('appTitle')?.textContent,
      resultCount: document.querySelector('.result-count')?.textContent,
      firstCard: document.querySelector('.card-ja')?.textContent,
    })`,
    returnByValue: true,
  });

  console.log('--- 画面 ---');
  console.log(JSON.parse(probe.result.value));

  console.log('\n--- コンソール ---');
  if (!logs.length) console.log('  （エラーなし）');
  for (const l of logs) console.log(`  [${l.level}] ${l.text}`);

  if (shot) {
    const img = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    writeFileSync(shot, Buffer.from(img.data, 'base64'));
    console.log(`\nscreenshot → ${shot}`);
  }

  const bad = logs.filter((l) => l.level === 'error' || l.level === 'exception');
  process.exitCode = bad.length ? 1 : 0;

  ws.close();
} finally {
  killBrowser(proc);
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* 使用中なら放置 */ }
}
