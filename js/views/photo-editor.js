/** 写真の登録・編集モーダル */

import * as photoStore from '../photos.js';
import { photos as photoDb } from '../db.js';
import { createCropper } from '../cropper.js';
import {
  el, modal, toast, confirmDialog,
  toLocalInput, fromLocalInput, formatDate,
} from '../ui.js';

const THUMB_SIZE = 640;   // トリミング後の正方形サムネの一辺(px)

/**
 * 新規登録。file と speciesId を渡す。
 * 既存編集のときは record を渡す（file は不要）。
 */
export async function open({ speciesId, file, record, onSaved }) {
  let prepared = null;
  let fullBlob = null;      // 保存する元画像（1600px）

  if (file) {
    try {
      prepared = await photoStore.prepare(file);
    } catch (err) {
      toast(err.message || '写真を読み込めませんでした');
      return;
    }
    fullBlob = prepared.full;
  } else if (record) {
    fullBlob = record.blob;
  }

  // トリミング画面（正方形）。元画像から作り、既存写真なら前回の枠を復元する。
  let cropper = null;
  if (fullBlob) {
    try {
      cropper = await createCropper({ blob: fullBlob, crop: record?.crop || null });
    } catch (err) {
      toast(err.message || '写真を表示できませんでした');
      return;
    }
  }

  const exif = prepared?.exif || null;

  // 初期値：編集なら既存値、新規なら EXIF 由来
  const init = record || {
    context: '',
    facility: '',
    placeName: '',
    lat: exif?.lat ?? null,
    lng: exif?.lng ?? null,
    takenAt: exif?.dateTimeOriginal ? exif.dateTimeOriginal.toISOString() : null,
    note: '',
  };

  let context = init.context || '';
  let lat = init.lat ?? null;
  let lng = init.lng ?? null;

  const facilities = await photoStore.facilityNames();

  /* ---------- フォーム部品 ---------- */

  const facilityInput = el('input', {
    type: 'text',
    list: 'facility-options',
    placeholder: '例: 上野動物園 両生爬虫類館',
    value: init.facility || '',
    autocomplete: 'off',
  });

  const facilityChips = el('div', { class: 'chips', style: 'margin-top:7px' },
    facilities.slice(0, 6).map((name) =>
      el('button', {
        type: 'button',
        class: 'chip',
        onclick: () => { facilityInput.value = name; },
        text: name,
      })
    )
  );

  const captiveBlock = el('div', { class: 'field' },
    el('label', {}, '施設名 ', el('span', { class: 'req' }, '*')),
    facilityInput,
    el('datalist', { id: 'facility-options' },
      facilities.map((n) => el('option', { value: n }))
    ),
    facilities.length ? facilityChips : null,
    el('div', { class: 'hint', text: '水族館・動物園・爬虫類カフェなど。過去に入力した施設名が候補に出ます。' })
  );

  const placeInput = el('input', {
    type: 'text',
    placeholder: '例: 栃木県日光市 中禅寺湖畔',
    value: init.placeName || '',
  });

  const gpsText = el('div', { class: 'hint' });

  const gpsBtn = el('button', {
    type: 'button',
    class: 'btn sm',
    onclick: async () => {
      gpsBtn.disabled = true;
      gpsBtn.textContent = '取得中…';
      try {
        const pos = await currentPosition();
        lat = round6(pos.coords.latitude);
        lng = round6(pos.coords.longitude);
        paintGps();
        toast('現在地を設定しました');
      } catch {
        toast('現在地を取得できませんでした');
      } finally {
        gpsBtn.disabled = false;
        gpsBtn.textContent = '現在地を使う';
      }
    },
  }, '現在地を使う');

  const gpsClear = el('button', {
    type: 'button',
    class: 'btn sm',
    onclick: () => { lat = null; lng = null; paintGps(); },
  }, '座標を消す');

  const wildBlock = el('div', {},
    el('div', { class: 'field' },
      el('label', {}, '地名'),
      placeInput,
      el('div', { class: 'hint', text: '自由入力。都道府県＋市町村＋地名など。' })
    ),
    el('div', { class: 'field' },
      el('label', {}, 'GPS座標'),
      gpsText,
      el('div', { class: 'btn-row', style: 'margin-top:7px' }, gpsBtn, gpsClear)
    )
  );

  function paintGps() {
    gpsText.textContent = '';
    if (lat != null && lng != null) {
      gpsText.append(
        el('span', { style: 'font-family:ui-monospace,monospace;color:var(--text)' },
          `${lat.toFixed(6)}, ${lng.toFixed(6)}`),
        ' ',
        el('a', {
          href: `https://www.google.com/maps?q=${lat},${lng}`,
          target: '_blank',
          rel: 'noopener',
        }, '地図で見る'),
        exif?.lat != null && lat === exif.lat
          ? el('span', { text: '（写真のEXIFから自動取得）', style: 'display:block' })
          : null
      );
    } else {
      gpsText.textContent = '座標なし。写真にGPS情報が無い場合は「現在地を使う」で補えます。';
    }
  }
  paintGps();

  const dateInput = el('input', {
    type: 'datetime-local',
    value: toLocalInput(init.takenAt),
  });

  const dateHint = el('div', { class: 'hint' },
    exif?.dateTimeOriginal
      ? `EXIFから自動入力: ${formatDate(exif.dateTimeOriginal.toISOString())}（修正できます）`
      : file
        ? '写真に撮影日時がありませんでした。手で入力してください。'
        : '撮影日時'
  );

  const noteInput = el('textarea', {
    placeholder: '色・鳴き声・行動・一緒にいた生き物など',
    rows: 3,
  });
  noteInput.value = init.note || '';

  // メイン写真の指定は既存写真の編集時だけ（新規はまだ1枚目なので自動で表紙になる）
  const coverInput = record ? el('input', { type: 'checkbox' }) : null;
  if (coverInput) coverInput.checked = !!record.cover;
  const coverBlock = record
    ? el('div', { class: 'field' },
        el('label', { class: 'cover-toggle' },
          coverInput,
          el('span', {}, 'この写真を一覧のメインにする'),
        ),
        el('div', { class: 'hint', text: '選ばないときは野生＞展示＞新しい順で自動的にメインを選びます。' })
      )
    : null;

  const contextArea = el('div', { class: 'field' });

  const segWild = el('button', {
    type: 'button',
    class: 'wild',
    'aria-pressed': String(context === 'wild'),
    onclick: () => setContext('wild'),
  }, el('span', {}, '🌿 野外'), el('span', { class: 'sub' }, 'フィールドで観察'));

  const segCaptive = el('button', {
    type: 'button',
    class: 'captive',
    'aria-pressed': String(context === 'captive'),
    onclick: () => setContext('captive'),
  }, el('span', {}, '🏛 飼育展示'), el('span', { class: 'sub' }, '水族館・動物園など'));

  const detailArea = el('div');

  function setContext(v) {
    context = v;
    segWild.setAttribute('aria-pressed', String(v === 'wild'));
    segCaptive.setAttribute('aria-pressed', String(v === 'captive'));
    detailArea.replaceChildren(v === 'captive' ? captiveBlock : v === 'wild' ? wildBlock : '');
    if (exif?.lat != null && v === 'wild' && lat == null) {
      lat = exif.lat;
      lng = exif.lng;
      paintGps();
    }
  }

  contextArea.append(
    el('label', {}, '観察シチュエーション ', el('span', { class: 'req' }, '*')),
    el('div', { class: 'segmented' }, segWild, segCaptive)
  );

  const exifNote = exif && (exif.make || exif.model)
    ? el('div', { class: 'hint', style: 'margin-top:-4px', text: `撮影機材: ${[exif.make, exif.model].filter(Boolean).join(' ')}` })
    : null;

  const body = el('div', {},
    cropper ? cropper.element : null,
    exifNote,
    contextArea,
    detailArea,
    el('div', { class: 'field' },
      el('label', {}, '撮影日時'),
      dateInput,
      dateHint
    ),
    el('div', { class: 'field' },
      el('label', {}, 'メモ'),
      noteInput
    ),
    coverBlock
  );

  /* ---------- 保存 ---------- */

  const saveBtn = el('button', { class: 'btn primary', onclick: doSave }, record ? '更新' : '登録');

  const footer = [
    record
      ? el('button', {
          class: 'btn danger',
          onclick: async () => {
            if (!(await confirmDialog('この写真を削除しますか？（元に戻せません）', { okLabel: '削除', danger: true }))) return;
            await photoStore.remove(record.id);
            m.close();
            toast('写真を削除しました');
            if (onSaved) onSaved();
          },
        }, '削除')
      : el('button', { class: 'btn', onclick: () => m.close() }, 'キャンセル'),
    saveBtn,
  ];

  const m = modal({
    title: record ? '写真を編集' : '写真を登録',
    body,
    footer,
    onClose: () => cropper?.destroy(),
  });

  setContext(context);

  async function doSave() {
    if (context !== 'wild' && context !== 'captive') {
      toast('観察シチュエーションを選んでください');
      return;
    }
    if (context === 'captive' && !facilityInput.value.trim()) {
      toast('施設名を入力してください');
      facilityInput.focus();
      return;
    }

    saveBtn.disabled = true;
    try {
      // トリミング枠から正方形サムネを作る。失敗しても既存サムネで保存を続ける。
      let thumb = record?.thumb || null;
      let crop = record?.crop || null;
      if (cropper) {
        try {
          crop = cropper.getCrop();
          thumb = await cropper.render(THUMB_SIZE);
        } catch { /* サムネ生成に失敗しても登録自体は通す */ }
      }

      const rec = {
        id: record?.id,
        speciesId: record?.speciesId || speciesId,
        context,
        facility: facilityInput.value,
        placeName: placeInput.value,
        lat,
        lng,
        takenAt: fromLocalInput(dateInput.value),
        note: noteInput.value,
        createdAt: record?.createdAt,
        blob: record?.blob || prepared.full,
        thumb: thumb || record?.blob || prepared.full,
        crop,
        width: record?.width ?? prepared?.width,
        height: record?.height ?? prepared?.height,
        cover: coverInput ? coverInput.checked : record?.cover,
      };
      const saved = await photoStore.save(rec);
      // メイン指定は1種につき1枚だけ。指定したら他の写真の指定を外す。
      if (coverInput) await photoStore.setCover(saved.speciesId, saved.id, coverInput.checked);
      m.close();
      toast(record ? '更新しました' : '写真を登録しました');
      if (onSaved) onSaved();
    } catch (err) {
      toast(err.message || '保存に失敗しました');
      saveBtn.disabled = false;
    }
  }
}

/** 既存写真を id から開く */
export async function edit(id, onSaved) {
  const record = await photoDb.get(id);
  if (!record) {
    toast('写真が見つかりません');
    return;
  }
  await open({ record, onSaved });
}

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('この端末では位置情報を使えません'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000,
    });
  });
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;
