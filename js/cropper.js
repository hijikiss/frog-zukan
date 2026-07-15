/**
 * 正方形トリミングUI。
 *
 * 使い方:
 *   const cropper = await createCropper({ blob, crop });
 *   container.append(cropper.element);   // DOM に入れると自動でレイアウト
 *   const params = cropper.getCrop();    // { cx, cy, z }（再編集用に保存）
 *   const squareBlob = await cropper.render(640);  // 正方形の JPEG
 *   cropper.destroy();
 *
 * 操作: ドラッグで移動、スライダー / ホイール / ピンチで拡大。
 * 画像は常に枠を覆う（cover）ので、隙間は生じない。
 *
 * 状態は {z, cx, cy}（拡大率と、枠中心が指す元画像の正規化座標）で持つ。
 * これは表示サイズに依存しないので、画面幅が変わっても破綻しない。
 */

import { el } from './ui.js';

const Z_MAX = 6;

export async function createCropper({ blob, crop } = {}) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = 'async';
  img.draggable = false;
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('画像を表示できませんでした'));
    img.src = url;
  });

  const natW = img.naturalWidth;
  const natH = img.naturalHeight;

  let z = clampZ(crop?.z ?? 1);
  let cx = crop?.cx ?? 0.5;
  let cy = crop?.cy ?? 0.5;

  Object.assign(img.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    transformOrigin: '0 0',
    width: `${natW}px`,
    height: `${natH}px`,
    willChange: 'transform',
    userSelect: 'none',
    pointerEvents: 'none',
  });

  const frame = el('div', { class: 'crop-frame' }, img, el('div', { class: 'crop-grid', 'aria-hidden': 'true' }));

  const slider = el('input', {
    type: 'range', min: '1', max: String(Z_MAX), step: '0.01', value: String(z),
    'aria-label': '拡大率',
    oninput: () => { setZoom(Number(slider.value), 0.5, 0.5); },
  });

  const controls = el('div', { class: 'crop-controls' },
    el('button', { type: 'button', class: 'crop-btn', 'aria-label': '縮小', onclick: () => nudgeZoom(-0.3) }, '－'),
    slider,
    el('button', { type: 'button', class: 'crop-btn', 'aria-label': '拡大', onclick: () => nudgeZoom(0.3) }, '＋'),
    el('button', { type: 'button', class: 'crop-btn reset', onclick: reset }, 'リセット')
  );

  const element = el('div', { class: 'cropper' },
    frame,
    controls,
    el('div', { class: 'hint', text: 'ドラッグで位置、スライダーで拡大。カエルを枠の中心に。' })
  );

  /* ---- レイアウト（状態 → transform）---- */

  const frameSize = () => frame.clientWidth || 1;

  // 元画像の「枠に見える正方形」の一辺（元画像ピクセル）。表示サイズに依存しない。
  const srcSide = () => Math.min(natW, natH) / z;

  function clampCenter() {
    const side = srcSide();
    const halfX = side / 2 / natW;
    const halfY = side / 2 / natH;
    cx = Math.min(Math.max(cx, halfX), 1 - halfX);
    cy = Math.min(Math.max(cy, halfY), 1 - halfY);
  }

  function layout() {
    clampCenter();
    const F = frameSize();
    const s = F / (Math.min(natW, natH) / z); // 元px → 表示px
    const side = srcSide();
    const sx = cx * natW - side / 2;
    const sy = cy * natH - side / 2;
    img.style.transform = `translate(${-sx * s}px, ${-sy * s}px) scale(${s})`;
    if (slider.value !== String(z)) slider.value = String(z);
  }

  /* ---- 操作 ---- */

  function setZoom(next) {
    z = clampZ(next);
    layout();
  }
  function nudgeZoom(d) { setZoom(z + d); }
  function reset() { z = 1; cx = 0.5; cy = 0.5; layout(); }

  // ドラッグ / ピンチ
  const pointers = new Map();
  let last = null;       // 1本指: {x,y}
  let pinch = null;      // 2本指: {dist}

  function onDown(e) {
    frame.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) last = { x: e.clientX, y: e.clientY };
    else if (pointers.size === 2) pinch = { dist: pointerDist() };
  }

  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size >= 2) {
      const d = pointerDist();
      if (pinch && pinch.dist > 0) setZoom(z * (d / pinch.dist));
      pinch = { dist: d };
      return;
    }

    if (!last) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };

    const F = frameSize();
    const s = F / (Math.min(natW, natH) / z);
    // 表示px の移動を、元画像の正規化中心の移動に変換
    cx -= dx / s / natW;
    cy -= dy / s / natH;
    layout();
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) last = null;
    else {
      const p = [...pointers.values()][0];
      last = { x: p.x, y: p.y };
    }
  }

  function pointerDist() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onWheel(e) {
    e.preventDefault();
    setZoom(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }

  frame.addEventListener('pointerdown', onDown);
  frame.addEventListener('pointermove', onMove);
  frame.addEventListener('pointerup', onUp);
  frame.addEventListener('pointercancel', onUp);
  frame.addEventListener('wheel', onWheel, { passive: false });

  // DOM に入る / 画面幅が変わるたびに再レイアウト
  const ro = new ResizeObserver(() => layout());
  ro.observe(frame);
  layout();

  /* ---- 出力 ---- */

  function getCrop() {
    clampCenter();
    return { cx: round4(cx), cy: round4(cy), z: round4(z) };
  }

  async function render(size = 640) {
    clampCenter();
    const side = srcSide();
    let sx = cx * natW - side / 2;
    let sy = cy * natH - side / 2;
    sx = Math.min(Math.max(sx, 0), natW - side);
    sy = Math.min(Math.max(sy, 0), natH - side);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('画像を変換できませんでした'))),
        'image/jpeg',
        0.85
      );
    });
  }

  function destroy() {
    ro.disconnect();
    URL.revokeObjectURL(url);
  }

  return { element, getCrop, render, destroy, natW, natH };
}

const clampZ = (v) => Math.min(Math.max(Number.isFinite(v) ? v : 1, 1), Z_MAX);
const round4 = (n) => Math.round(n * 1e4) / 1e4;
