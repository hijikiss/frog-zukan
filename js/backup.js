/**
 * 全データ（写真含む）の JSON エクスポート / インポート。
 * 端末間の手動同期用。写真は data URL（base64）で埋め込む。
 */

import { photos, overrides } from './db.js';

const FORMAT = 'frog-zukan-backup';
const VERSION = 1;

/* ---------------- Blob <-> base64 ---------------- */

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

/* ---------------- エクスポート ---------------- */

/**
 * @param {{includePhotos: boolean, onProgress?: (done, total) => void}} opts
 * @returns {Blob} JSON ファイル
 */
export async function exportAll({ includePhotos = true, onProgress } = {}) {
  const [photoList, ovList] = await Promise.all([photos.all(), overrides.all()]);

  const out = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    includesPhotos: includePhotos,
    speciesOverrides: ovList,
    photos: [],
  };

  let done = 0;
  for (const p of photoList) {
    const rec = {
      id: p.id,
      speciesId: p.speciesId,
      context: p.context,
      facility: p.facility,
      placeName: p.placeName,
      lat: p.lat,
      lng: p.lng,
      takenAt: p.takenAt,
      note: p.note,
      crop: p.crop || null,
      width: p.width,
      height: p.height,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
    if (includePhotos) {
      rec.image = await blobToDataUrl(p.blob);
      rec.thumbImage = p.thumb ? await blobToDataUrl(p.thumb) : null;
    }
    out.photos.push(rec);
    onProgress?.(++done, photoList.length);
  }

  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function defaultFilename() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `frog-zukan-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
}

/* ---------------- インポート ---------------- */

/**
 * mode:
 *   'merge'   — 既存を残し、同じ id のものは上書き（既定）
 *   'replace' — 既存の写真・種編集をすべて消してから取り込む
 *
 * @returns {{photos: number, skipped: number, species: number}}
 */
export async function importFile(file, { mode = 'merge', onProgress } = {}) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSONとして読めませんでした');
  }

  if (!data || data.format !== FORMAT) {
    throw new Error('このアプリのバックアップファイルではありません');
  }
  if (Number(data.version) > VERSION) {
    throw new Error('新しいバージョンのバックアップです。アプリを更新してください');
  }

  if (mode === 'replace') {
    await photos.clear();
    await overrides.clear();
  }

  // 種の編集
  let speciesCount = 0;
  for (const o of data.speciesOverrides || []) {
    if (!o || !o.id) continue;
    await overrides.put(o);
    speciesCount++;
  }

  // 写真
  const existing = new Set((await photos.all()).map((p) => p.id));
  let imported = 0;
  let skipped = 0;
  const list = data.photos || [];

  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    onProgress?.(i + 1, list.length);

    if (!p || !p.id || !p.speciesId) { skipped++; continue; }
    if (!p.image) { skipped++; continue; }           // 写真なしエクスポートは復元できない
    if (mode === 'merge' && existing.has(p.id)) { skipped++; continue; }

    try {
      const blob = await dataUrlToBlob(p.image);
      const thumb = p.thumbImage ? await dataUrlToBlob(p.thumbImage) : blob;
      await photos.put({
        id: p.id,
        speciesId: p.speciesId,
        context: p.context === 'wild' ? 'wild' : 'captive',
        facility: p.facility || '',
        placeName: p.placeName || '',
        lat: Number.isFinite(p.lat) ? p.lat : null,
        lng: Number.isFinite(p.lng) ? p.lng : null,
        takenAt: p.takenAt || null,
        note: p.note || '',
        crop: p.crop || null,
        width: p.width || null,
        height: p.height || null,
        blob,
        thumb,
        createdAt: p.createdAt || new Date().toISOString(),
        updatedAt: p.updatedAt || new Date().toISOString(),
      });
      imported++;
    } catch {
      skipped++;
    }
  }

  return { photos: imported, skipped, species: speciesCount };
}
