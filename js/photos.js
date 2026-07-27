/**
 * 写真の取り込み・リサイズ・登録。
 *
 * 元ファイル（数MB）をそのまま IndexedDB に入れると端末容量をすぐ食い潰すので、
 * 長辺 1600px に縮小した「元画像」(blob) を保存する。
 * サムネ (thumb) はユーザーがトリミングした正方形を cropper.js が作る。
 */

import { photos } from './db.js';
import { parseExif } from './exif.js';

const FULL_MAX = 1600;

/**
 * 種がまだ決まっていない写真に使う speciesId。
 * 実在の種 id（英小文字とハイフン）と衝突しない形にしてあるので、
 * 図鑑の集計（sp.get が見つけられない）には自然と混ざらない。
 */
export const UNIDENTIFIED = '__unidentified__';
export const isUnidentified = (speciesId) => speciesId === UNIDENTIFIED;

/** ファイルから EXIF を読む（撮影日時・GPS） */
export async function readExif(file) {
  if (!file || !/jpe?g/i.test(file.type)) return null;
  // EXIF は先頭にあるので、先頭 256KB だけ読めば足りる
  const head = file.slice(0, 256 * 1024);
  const buf = await head.arrayBuffer();
  return parseExif(buf);
}

async function toBitmap(file) {
  // imageOrientation: 'from-image' で EXIF の回転を反映させる
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* 古い Safari 等は次の手へ */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('画像を読み込めませんでした'));
      img.src = url;
    });
    return img;
  } finally {
    // Image は src 読み込み後に revoke してよい
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function resize(source, maxSide, quality) {
  const sw = source.width || source.naturalWidth;
  const sh = source.height || source.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve({ blob, w, h }) : reject(new Error('画像を変換できませんでした'))),
      'image/jpeg',
      quality
    );
  });
}

/**
 * ファイルを読み込み、登録用の下書きを作る（まだ保存はしない）。
 * サムネはトリミング画面（cropper）で作るので、ここでは元画像だけ用意する。
 * @returns {{full: Blob, width, height, exif}}
 */
export async function prepare(file) {
  const exif = await readExif(file);
  const bmp = await toBitmap(file);
  const full = await resize(bmp, FULL_MAX, 0.85);
  if (bmp.close) bmp.close();

  return {
    full: full.blob,
    width: full.w,
    height: full.h,
    exif: exif || null,
  };
}

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/**
 * 写真レコードを保存。
 * rec: { id?, speciesId, context:'wild'|'captive', facility, placeName, lat, lng,
 *        takenAt (ISO文字列|null), note, blob, thumb, crop, width, height }
 *   blob  … 長辺1600pxの元画像（ライトボックスで全体を表示）
 *   thumb … ユーザーがトリミングした正方形（カード・ギャラリー・ヒーローで表示）
 *   crop  … トリミング位置 {cx,cy,z}（再編集時に枠を復元する）
 */
export async function save(rec) {
  const now = new Date().toISOString();
  const record = {
    id: rec.id || newId(),
    speciesId: rec.speciesId,
    context: rec.context,                         // 'wild' | 'captive'
    facility: rec.context === 'captive' ? (rec.facility || '').trim() : '',
    placeName: rec.context === 'wild' ? (rec.placeName || '').trim() : '',
    lat: Number.isFinite(rec.lat) ? rec.lat : null,
    lng: Number.isFinite(rec.lng) ? rec.lng : null,
    takenAt: rec.takenAt || null,
    note: (rec.note || '').trim(),
    blob: rec.blob,
    thumb: rec.thumb,
    crop: rec.crop || null,
    width: rec.width || null,
    height: rec.height || null,
    cover: !!rec.cover,                           // 一覧のメイン写真に手動指定したか
    createdAt: rec.createdAt || now,
    updatedAt: now,
  };
  await photos.put(record);
  return record;
}

export const remove = (id) => photos.remove(id);

/**
 * その種の「メイン写真」を1枚だけに設定する。
 * on=true なら photoId をメインにして他を解除、on=false なら photoId のメイン指定を外す。
 * 手動指定が無ければ species.js が自動（野生＞展示＞新しい順）で選ぶ。
 */
export async function setCover(speciesId, photoId, on = true) {
  const list = await photos.bySpecies(speciesId);
  for (const p of list) {
    const want = on && p.id === photoId;
    if (!!p.cover !== want) await photos.put({ ...p, cover: want });
  }
}

/** まだ種を決めていない写真（新しい順） */
export async function unidentified() {
  const all = await photos.all();
  return all
    .filter((p) => isUnidentified(p.speciesId))
    .sort((a, b) => (b.takenAt || b.createdAt || '').localeCompare(a.takenAt || a.createdAt || ''));
}

/** 未同定の写真に種を決める（写真の他の内容はそのまま） */
export async function assignSpecies(photoId, speciesId) {
  const rec = await photos.get(photoId);
  if (!rec) return null;
  const updated = { ...rec, speciesId, updatedAt: new Date().toISOString() };
  await photos.put(updated);
  return updated;
}

/** 施設名の入力候補（過去に入力したもの、使用回数の多い順） */
export async function facilityNames() {
  const all = await photos.all();
  const counts = new Map();
  for (const p of all) {
    if (p.context === 'captive' && p.facility) {
      counts.set(p.facility, (counts.get(p.facility) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name);
}

/** 施設ごとの集計（施設一覧ページ用） */
export async function facilitySummary() {
  const all = await photos.all();
  const map = new Map();
  for (const p of all) {
    if (p.context !== 'captive' || !p.facility) continue;
    if (!map.has(p.facility)) {
      map.set(p.facility, { name: p.facility, species: new Set(), photoCount: 0, lastVisit: null });
    }
    const f = map.get(p.facility);
    // 未同定は「◯種」に数えない（種が決まってから数える）
    if (!isUnidentified(p.speciesId)) f.species.add(p.speciesId);
    f.photoCount++;
    const t = p.takenAt || p.createdAt;
    if (t && (!f.lastVisit || t > f.lastVisit)) f.lastVisit = t;
  }
  return [...map.values()]
    .map((f) => ({ ...f, speciesIds: [...f.species], speciesCount: f.species.size }))
    .sort((a, b) => b.speciesCount - a.speciesCount || a.name.localeCompare(b.name, 'ja'));
}
