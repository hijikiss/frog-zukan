/**
 * タッチ操作のまとめ。
 *
 * iOS Safari の事情:
 *   ページのピンチズームは `touch-action: none` では止められない。WebKit 独自の
 *   gesture イベントを preventDefault するしかない。しかもピンチが始まると
 *   pointer イベントは打ち切られるので、2本指の処理は gesture 側で受ける必要がある。
 *   （Android / PC は pointer イベントで 2本指を取れる）
 *
 * このモジュールは
 *   lockPageZoom() … アプリ全体でページの拡大縮小を止める（画面を固定する）
 *   dragZoom()     … 特定の要素の上だけ、ドラッグと拡大縮小を自前で受け取る
 * の2つを提供する。写真の拡大は dragZoom を使う側（cropper / lightbox）が実装する。
 */

/**
 * ページ自体の拡大縮小を止める。アプリ起動時に一度だけ呼ぶ。
 * 1本指の操作（スクロール・タップ）はそのまま通すので、通常の操作性は変わらない。
 */
export function lockPageZoom() {
  const stop = (e) => e.preventDefault();
  const stopMulti = (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); };
  const opts = { capture: true, passive: false };

  // iOS（WebKit）のピンチ
  document.addEventListener('gesturestart', stop, opts);
  document.addEventListener('gesturechange', stop, opts);
  document.addEventListener('gestureend', stop, opts);

  // Android / その他。2本指のときだけ止める
  document.addEventListener('touchstart', stopMulti, opts);
  document.addEventListener('touchmove', stopMulti, opts);

  // PC の Ctrl+ホイール
  document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, opts);
}

/**
 * 要素の上でのドラッグ・ピンチ・ホイールを受け取る。
 *
 *   const g = dragZoom(el, {
 *     onPan(dx, dy)        表示px の移動量
 *     onZoom(factor, focal) 直前からの倍率と、要素内の焦点 {x, y}（要素の左上が原点）
 *   });
 *   g.destroy();
 *
 * @returns {{destroy: Function}}
 */
export function dragZoom(target, { onPan, onZoom } = {}) {
  const pointers = new Map();
  let last = null;          // 1本指: クライアント座標
  let pinch = null;         // 2本指: {dist, mid}
  let usingGesture = false; // iOS の gesture で処理中（pointer 経路は止める）
  let gestureScale = 1;

  /** クライアント座標 → 要素内の座標 */
  const toLocal = (x, y) => {
    const r = target.getBoundingClientRect();
    return { x: x - r.left, y: y - r.top };
  };

  const center = () => {
    const r = target.getBoundingClientRect();
    return { x: r.width / 2, y: r.height / 2 };
  };

  const pointerDist = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const pointerMid = () => {
    const [a, b] = [...pointers.values()];
    return toLocal((a.x + b.x) / 2, (a.y + b.y) / 2);
  };

  function onDown(e) {
    // pointercancel 後や合成イベントでは捕捉できないことがある
    try { target.setPointerCapture(e.pointerId); } catch { /* 捕捉できなくても操作は続く */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) last = { x: e.clientX, y: e.clientY };
    else if (pointers.size === 2) pinch = { dist: pointerDist(), mid: pointerMid() };
  }

  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size >= 2) {
      if (usingGesture) return;   // iOS では gesture 側で拡大するので二重に効かせない
      const d = pointerDist();
      const mid = pointerMid();
      if (pinch) {
        if (pinch.dist > 0 && d > 0) onZoom?.(d / pinch.dist, mid);
        // ピンチしたまま指を平行移動したぶんも追従させる
        onPan?.(mid.x - pinch.mid.x, mid.y - pinch.mid.y);
      }
      pinch = { dist: d, mid };
      last = null;
      return;
    }

    if (!last) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    onPan?.(dx, dy);
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) last = null;
    else last = { ...[...pointers.values()][0] };
  }

  function onWheel(e) {
    e.preventDefault();
    onZoom?.(e.deltaY < 0 ? 1.1 : 1 / 1.1, toLocal(e.clientX, e.clientY));
  }

  /* iOS（WebKit）のピンチ。scale はジェスチャ開始時からの倍率なので、差分に直して渡す。 */

  function onGestureStart(e) {
    e.preventDefault();
    usingGesture = true;
    gestureScale = 1;
    pinch = null;
  }

  function onGestureChange(e) {
    e.preventDefault();
    if (!usingGesture) return;
    const s = e.scale || 1;
    const focal = Number.isFinite(e.clientX) ? toLocal(e.clientX, e.clientY) : center();
    if (gestureScale > 0) onZoom?.(s / gestureScale, focal);
    gestureScale = s;
  }

  function onGestureEnd(e) {
    e.preventDefault();
    usingGesture = false;
    pinch = null;
    // 指が1本残っていれば、そこからドラッグを続けられるようにする
    last = pointers.size === 1 ? { ...[...pointers.values()][0] } : null;
  }

  target.addEventListener('pointerdown', onDown);
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
  target.addEventListener('wheel', onWheel, { passive: false });
  target.addEventListener('gesturestart', onGestureStart);
  target.addEventListener('gesturechange', onGestureChange);
  target.addEventListener('gestureend', onGestureEnd);

  return {
    destroy() {
      target.removeEventListener('pointerdown', onDown);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      target.removeEventListener('wheel', onWheel);
      target.removeEventListener('gesturestart', onGestureStart);
      target.removeEventListener('gesturechange', onGestureChange);
      target.removeEventListener('gestureend', onGestureEnd);
    },
  };
}
