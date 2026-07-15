/**
 * 最小 EXIF パーサ。
 *
 * exif-js などの外部ライブラリを使わず自前で持つ理由:
 *   - CDN 依存だとオフライン（＝PWA として使う本来の場面）で壊れる
 *   - 実際に必要なのは「撮影日時」と「GPS」だけで、それは APP1/TIFF を素直に辿れば取れる
 *
 * 取得するもの:
 *   dateTimeOriginal (Date)  … DateTimeOriginal → 無ければ DateTime
 *   lat / lng (number)       … GPSLatitude / GPSLongitude（度に変換済み、南緯・西経は負）
 *   altitude (number)
 *   make / model (string)    … 参考情報
 */

const TAG = {
  DATETIME: 0x0132,
  EXIF_IFD: 0x8769,
  GPS_IFD: 0x8825,
  MAKE: 0x010f,
  MODEL: 0x0110,
  DATETIME_ORIGINAL: 0x9003,
  DATETIME_DIGITIZED: 0x9004,
  OFFSET_TIME_ORIGINAL: 0x9011,
  GPS_LAT_REF: 0x0001,
  GPS_LAT: 0x0002,
  GPS_LNG_REF: 0x0003,
  GPS_LNG: 0x0004,
  GPS_ALT_REF: 0x0005,
  GPS_ALT: 0x0006,
};

// TIFF タイプごとの 1 要素あたりバイト数
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

/**
 * @param {ArrayBuffer} buf
 * @returns {{dateTimeOriginal?: Date, lat?: number, lng?: number, altitude?: number,
 *            make?: string, model?: string} | null}
 */
export function parseExif(buf) {
  try {
    return parse(buf);
  } catch {
    return null; // 壊れた EXIF で写真登録そのものを止めない
  }
}

function parse(buf) {
  const view = new DataView(buf);
  if (view.byteLength < 4) return null;

  // JPEG のみ。HEIC/PNG は EXIF を持っていても構造が違うので諦める
  if (view.getUint16(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) { offset++; continue; }
    const marker = view.getUint8(offset + 1);

    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // 画像データ本体に入った

    const size = view.getUint16(offset + 2);
    if (size < 2) break;

    if (marker === 0xe1 && offset + 10 <= view.byteLength) {
      // "Exif\0\0"
      if (view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0x0000) {
        return readTiff(view, offset + 10);
      }
    }
    offset += 2 + size;
  }
  return null;
}

function readTiff(view, tiffStart) {
  if (tiffStart + 8 > view.byteLength) return null;

  const bom = view.getUint16(tiffStart);
  let le;
  if (bom === 0x4949) le = true;        // "II" little endian
  else if (bom === 0x4d4d) le = false;  // "MM" big endian
  else return null;

  if (view.getUint16(tiffStart + 2, le) !== 0x002a) return null;

  const ifd0 = tiffStart + view.getUint32(tiffStart + 4, le);
  const tags0 = readIfd(view, ifd0, tiffStart, le);
  if (!tags0) return null;

  const out = {};
  if (typeof tags0[TAG.MAKE] === 'string') out.make = tags0[TAG.MAKE].trim();
  if (typeof tags0[TAG.MODEL] === 'string') out.model = tags0[TAG.MODEL].trim();

  let dateStr = tags0[TAG.DATETIME];
  let offsetStr = null;

  // Exif SubIFD
  if (tags0[TAG.EXIF_IFD] != null) {
    const exifTags = readIfd(view, tiffStart + num(tags0[TAG.EXIF_IFD]), tiffStart, le);
    if (exifTags) {
      dateStr = exifTags[TAG.DATETIME_ORIGINAL] || exifTags[TAG.DATETIME_DIGITIZED] || dateStr;
      offsetStr = exifTags[TAG.OFFSET_TIME_ORIGINAL] || null;
    }
  }
  if (typeof dateStr === 'string') {
    const d = parseExifDate(dateStr, offsetStr);
    if (d) out.dateTimeOriginal = d;
  }

  // GPS IFD
  if (tags0[TAG.GPS_IFD] != null) {
    const g = readIfd(view, tiffStart + num(tags0[TAG.GPS_IFD]), tiffStart, le);
    if (g) {
      const lat = dms(g[TAG.GPS_LAT], g[TAG.GPS_LAT_REF], 'S');
      const lng = dms(g[TAG.GPS_LNG], g[TAG.GPS_LNG_REF], 'W');
      if (lat != null && lng != null && !(lat === 0 && lng === 0)) {
        out.lat = lat;
        out.lng = lng;
      }
      if (Array.isArray(g[TAG.GPS_ALT]) || typeof g[TAG.GPS_ALT] === 'number') {
        const alt = num(g[TAG.GPS_ALT]);
        if (Number.isFinite(alt)) {
          out.altitude = num(g[TAG.GPS_ALT_REF]) === 1 ? -alt : alt;
        }
      }
    }
  }

  return Object.keys(out).length ? out : null;
}

function readIfd(view, ifdStart, tiffStart, le) {
  if (ifdStart + 2 > view.byteLength) return null;
  const count = view.getUint16(ifdStart, le);
  const tags = {};

  for (let i = 0; i < count; i++) {
    const entry = ifdStart + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;

    const tag = view.getUint16(entry, le);
    const type = view.getUint16(entry + 2, le);
    const n = view.getUint32(entry + 4, le);
    const size = TYPE_SIZE[type];
    if (!size) continue;

    const bytes = size * n;
    let valOffset = entry + 8;
    if (bytes > 4) {
      valOffset = tiffStart + view.getUint32(entry + 8, le);
    }
    if (valOffset < 0 || valOffset + bytes > view.byteLength) continue;

    tags[tag] = readValue(view, valOffset, type, n, le);
  }
  return tags;
}

function readValue(view, off, type, n, le) {
  if (type === 2) { // ASCII
    let s = '';
    for (let i = 0; i < n; i++) {
      const c = view.getUint8(off + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }

  const vals = [];
  for (let i = 0; i < n; i++) {
    switch (type) {
      case 1: case 7: vals.push(view.getUint8(off + i)); break;
      case 3: vals.push(view.getUint16(off + i * 2, le)); break;
      case 4: vals.push(view.getUint32(off + i * 4, le)); break;
      case 6: vals.push(view.getInt8(off + i)); break;
      case 8: vals.push(view.getInt16(off + i * 2, le)); break;
      case 9: vals.push(view.getInt32(off + i * 4, le)); break;
      case 5: { // RATIONAL
        const a = view.getUint32(off + i * 8, le);
        const b = view.getUint32(off + i * 8 + 4, le);
        vals.push(b === 0 ? 0 : a / b);
        break;
      }
      case 10: { // SRATIONAL
        const a = view.getInt32(off + i * 8, le);
        const b = view.getInt32(off + i * 8 + 4, le);
        vals.push(b === 0 ? 0 : a / b);
        break;
      }
      case 11: vals.push(view.getFloat32(off + i * 4, le)); break;
      case 12: vals.push(view.getFloat64(off + i * 8, le)); break;
      default: return undefined;
    }
  }
  return vals.length === 1 ? vals[0] : vals;
}

const num = (v) => (Array.isArray(v) ? v[0] : v);

/** 度分秒 → 十進度 */
function dms(value, ref, negativeRef) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [d, m, s] = value;
  if (![d, m, s].every(Number.isFinite)) return null;
  let deg = d + m / 60 + s / 3600;
  if (typeof ref === 'string' && ref.trim().toUpperCase().startsWith(negativeRef)) deg = -deg;
  return Math.round(deg * 1e6) / 1e6;
}

/**
 * "2025:07:14 18:03:22" 形式をパース。
 * EXIF の日時はタイムゾーンを持たない（撮影地のローカル時刻）ので、
 * OffsetTimeOriginal があればそれを使い、無ければ端末ローカル時刻として解釈する。
 */
function parseExifDate(s, offsetStr) {
  const m = String(s).trim().match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m.map(Number);
  if (!y || y < 1900) return null;

  if (typeof offsetStr === 'string') {
    const om = offsetStr.trim().match(/^([+-])(\d{2}):(\d{2})/);
    if (om) {
      const sign = om[1] === '-' ? -1 : 1;
      const offMin = sign * (Number(om[2]) * 60 + Number(om[3]));
      return new Date(Date.UTC(y, mo - 1, d, h, mi, sec) - offMin * 60000);
    }
  }
  const date = new Date(y, mo - 1, d, h, mi, sec);
  return Number.isNaN(date.getTime()) ? null : date;
}
