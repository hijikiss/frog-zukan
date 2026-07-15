/** 設定：エクスポート / インポート / 種の追加 / ストレージ */

import * as sp from '../species.js';
import * as backup from '../backup.js';
import * as speciesEditor from './species-editor.js';
import { photos as photoDb, storageEstimate, requestPersist } from '../db.js';
import { el, clear, toast, modal, confirmDialog, formatBytes } from '../ui.js';

export async function render(view, { refresh }) {
  clear(view);

  const prog = sp.progress();
  const allPhotos = await photoDb.all();
  const est = await storageEstimate();

  /* ---- サマリ ---- */
  view.append(
    el('div', { class: 'panel' },
      el('div', { class: 'section-head' }, el('h3', {}, 'このデータ')),
      el('dl', { class: 'facts' },
        row('登録種数', `${prog.total}種`),
        row('観察済み', `${prog.observed}種（野生 ${prog.wild} / 展示のみ ${prog.captive}）`),
        row('写真', `${allPhotos.length}枚`)
      ),
      est ? el('div', { style: 'margin-top:12px' },
        el('div', { class: 'storage-bar' },
          el('div', { style: `width:${Math.min(100, (est.usage / (est.quota || 1)) * 100).toFixed(1)}%` })),
        el('div', { class: 'hint' },
          `使用 ${formatBytes(est.usage)} / 上限 ${formatBytes(est.quota)}`)
      ) : null
    )
  );

  /* ---- バックアップ ---- */
  const exportBtn = el('button', { class: 'btn primary block', onclick: doExport }, '⬇ エクスポート（写真ごと）');
  const exportMetaBtn = el('button', { class: 'btn block', onclick: () => doExport(false) }, '⬇ 記録だけ（写真なし・軽量）');

  const importInput = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    style: 'display:none',
    onchange: async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) await doImport(file);
    },
  });

  view.append(
    el('div', { class: 'panel' },
      el('div', { class: 'section-head' }, el('h3', {}, 'バックアップ / 端末間の同期')),
      el('p', { class: 'hint', style: 'margin:0 0 12px' },
        '写真はこの端末のブラウザ内（IndexedDB）にだけ保存されています。'
        + '別の端末で使うときや、ブラウザのデータを消す前に、JSONに書き出しておいてください。'),
      exportBtn,
      el('div', { style: 'height:8px' }),
      exportMetaBtn,
      el('div', { style: 'height:8px' }),
      el('button', { class: 'btn block', onclick: () => importInput.click() }, '⬆ インポート'),
      importInput
    )
  );

  /* ---- 種データ ---- */
  view.append(
    el('div', { class: 'panel' },
      el('div', { class: 'section-head' }, el('h3', {}, '種データ')),
      el('p', { class: 'hint', style: 'margin:0 0 12px' },
        '同梱の種データに誤りがあれば、各種の詳細画面から直せます。'
        + '編集内容は端末に保存され、アプリを更新しても消えません。'),
      el('button', {
        class: 'btn block',
        onclick: () => speciesEditor.open({ onSaved: refresh }),
      }, '＋ 種を自分で追加'),
      el('div', { style: 'height:8px' }),
      el('button', { class: 'btn block', onclick: showEdited }, '編集した種を確認')
    )
  );

  /* ---- その他 ---- */
  const persistBtn = el('button', {
    class: 'btn block',
    onclick: async () => {
      const ok = await requestPersist();
      toast(ok ? 'ストレージを永続化しました' : 'ブラウザに拒否されました（使い続けると自動で許可されることがあります）');
    },
  }, '🔒 ストレージの永続化を要求');

  view.append(
    el('div', { class: 'panel' },
      el('div', { class: 'section-head' }, el('h3', {}, 'その他')),
      persistBtn,
      el('div', { style: 'height:8px' }),
      el('button', {
        class: 'btn danger block',
        onclick: async () => {
          if (!(await confirmDialog(
            `写真 ${allPhotos.length}枚と種の編集をすべて削除します。元に戻せません。先にエクスポートしましたか？`,
            { okLabel: 'すべて削除', danger: true }
          ))) return;
          await photoDb.clear();
          const { overrides } = await import('../db.js');
          await overrides.clear();
          await refresh();
          toast('すべて削除しました');
          render(view, { refresh });
        },
      }, 'すべてのデータを削除'),
      el('p', { class: 'hint', style: 'margin-top:12px' },
        'カエル図鑑 — オフラインで動く個人用の記録アプリ。データは外部に送信されません。')
    )
  );

  /* ---- 処理 ---- */

  async function doExport(withPhotos = true) {
    const btn = withPhotos ? exportBtn : exportMetaBtn;
    const label = btn.textContent;
    btn.disabled = true;
    try {
      const blob = await backup.exportAll({
        includePhotos: withPhotos,
        onProgress: (done, total) => { btn.textContent = `書き出し中… ${done}/${total}`; },
      });
      backup.download(blob, backup.defaultFilename());
      toast(`エクスポートしました（${formatBytes(blob.size)}）`);
    } catch (err) {
      toast(err.message || 'エクスポートに失敗しました');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async function doImport(file) {
    const mode = await askMode();
    if (!mode) return;

    const status = el('p', { text: '読み込み中…' });
    const m = modal({ title: 'インポート', body: status });
    try {
      const res = await backup.importFile(file, {
        mode,
        onProgress: (done, total) => { status.textContent = `取り込み中… ${done}/${total}`; },
      });
      await refresh();
      m.close();
      toast(`写真${res.photos}枚・種編集${res.species}件を取り込みました${res.skipped ? `（${res.skipped}件スキップ）` : ''}`);
      render(view, { refresh });
    } catch (err) {
      m.close();
      toast(err.message || 'インポートに失敗しました');
    }
  }

  function askMode() {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; m.close(); resolve(v); } };
      const m = modal({
        title: 'インポート方法',
        body: el('div', {},
          el('p', { style: 'margin-top:0' }, '取り込み方を選んでください。'),
          el('button', {
            class: 'btn block primary',
            onclick: () => finish('merge'),
          }, '追加（おすすめ）'),
          el('p', { class: 'hint' }, '今あるデータを残したまま、無い写真だけ足します。'),
          el('div', { style: 'height:10px' }),
          el('button', {
            class: 'btn block danger',
            onclick: async () => {
              if (await confirmDialog('今ある写真と種の編集をすべて消してから取り込みます。よろしいですか？',
                { okLabel: '置き換える', danger: true })) finish('replace');
            },
          }, '置き換え'),
          el('p', { class: 'hint' }, 'この端末のデータを消して、ファイルの内容だけにします。')
        ),
        footer: [el('button', { class: 'btn', onclick: () => finish(null) }, 'キャンセル')],
        onClose: () => finish(null),
      });
    });
  }

  function showEdited() {
    const edited = sp.all().filter((s) => s._edited || sp.isCustom(s.id));
    const m = modal({
      title: `編集した種（${edited.length}）`,
      body: edited.length
        ? el('div', { class: 'list-rows' },
            edited.map((s) =>
              el('a', {
                class: 'row',
                href: `#/s/${encodeURIComponent(s.id)}`,
                onclick: () => m.close(),
              },
                el('span', { class: 'ico' }, sp.isCustom(s.id) ? '✨' : '✏️'),
                el('span', { class: 'main' },
                  el('span', { class: 't', text: s.nameJa }),
                  el('span', { class: 's', text: sp.isCustom(s.id) ? '自分で追加' : '編集済み' })
                ),
                el('span', { class: 'chev' }, '›')
              )
            )
          )
        : el('p', { text: 'まだ編集していません。' }),
    });
  }
}

const row = (k, v) => [el('dt', { text: k }), el('dd', { text: v })];
