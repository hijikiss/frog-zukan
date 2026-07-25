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
 * スマホでのピンチは gestures.js の dragZoom が受ける（iOS の事情はそちらに書いた）。
 * ページ自体が拡大しないのは、起動時の lockPageZoom() でアプリ全体を固定しているため。
 *
 * 状態は {z, cx, cy}（拡大率と、枠中心が指す元画像の正規化座標）で持つ。
 * これは表示サイズに依存しないので、画面幅が変わっても破綻しない。
 */

import { el } from './ui.js';
import { dragZoom } from './gestures.js';

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
    oninput: () => { setZoom(Number(slider.value)); },
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
    el('div', { class: 'hint', text: 'ドラッグで位置、ピンチ／スライダーで拡大。生き物を枠の中心に。' })
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

  /**
   * 拡大率を変える。focal（枠の左上を原点とした表示px）が指している元画像上の点は
   * 動かさない。指の間やカーソルの位置を基準に拡大できるので、狙った所へ寄れる。
   * focal 省略時は枠の中心。
   */
  function setZoom(next, focal) {
    const z0 = z;
    const z1 = clampZ(next);
    if (z1 === z0) return;

    const F = frameSize();
    const fx = focal ? focal.x : F / 2;
    const fy = focal ? focal.y : F / 2;
    const base = Math.min(natW, natH);
    const side0 = base / z0;
    const side1 = base / z1;

    // focal が指している元画像上の点（拡大の前後で動かさない点）
    const srcX = cx * natW - side0 / 2 + fx * (side0 / F);
    const srcY = cy * natH - side0 / 2 + fy * (side0 / F);

    z = z1;
    cx = (srcX + side1 / 2 - fx * (side1 / F)) / natW;
    cy = (srcY + side1 / 2 - fy * (side1 / F)) / natH;
    layout();
  }

  function nudgeZoom(d) { setZoom(z + d); }
  function reset() { z = 1; cx = 0.5; cy = 0.5; layout(); }

  /** 表示px の移動を、元画像の正規化中心の移動に変換して動かす */
  function panBy(dx, dy) {
    if (!dx && !dy) return;
    const F = frameSize();
    const s = F / (Math.min(natW, natH) / z);
    cx -= dx / s / natW;
    cy -= dy / s / natH;
    layout();
  }

  // ドラッグ / ピンチ / ホイール。iOS の事情は gestures.js が吸収する。
  const gestures = dragZoom(frame, {
    onPan: panBy,
    onZoom: (factor, focal) => setZoom(z * factor, focal),
  });

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
    gestures.destroy();
    URL.revokeObjectURL(url);
  }

  return { element, getCrop, render, destroy, natW, natH };
}

const clampZ = (v) => Math.min(Math.max(Number.isFinite(v) ? v : 1, 1), Z_MAX);
const round4 = (n) => Math.round(n * 1e4) / 1e4;
