/**
 * IndexedDB ラッパー。
 *
 * ストア:
 *   photos           — 自分で撮った写真（Blob 本体 + サムネ + 観察メタ）
 *   speciesOverrides — frogs.json への差分（編集・追加・削除）
 *   meta             — 設定など key/value
 */

const DB_NAME = 'frog-zukan';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('photos')) {
        const s = db.createObjectStore('photos', { keyPath: 'id' });
        s.createIndex('speciesId', 'speciesId');
        s.createIndex('facility', 'facility');
        s.createIndex('context', 'context');
      }
      if (!db.objectStoreNames.contains('speciesOverrides')) {
        db.createObjectStore('speciesOverrides', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      void e;
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try {
      out = fn(s);
    } catch (err) {
      reject(err);
      return;
    }
    t.oncomplete = () => resolve(out && out.__req ? out.__req.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const wrap = (req) => ({ __req: req });

/* ---------------- photos ---------------- */

export const photos = {
  all: () => tx('photos', 'readonly', (s) => wrap(s.getAll())),

  bySpecies: (speciesId) =>
    tx('photos', 'readonly', (s) => wrap(s.index('speciesId').getAll(speciesId))),

  byFacility: (facility) =>
    tx('photos', 'readonly', (s) => wrap(s.index('facility').getAll(facility))),

  get: (id) => tx('photos', 'readonly', (s) => wrap(s.get(id))),

  put: (rec) => tx('photos', 'readwrite', (s) => { s.put(rec); return rec; }),

  remove: (id) => tx('photos', 'readwrite', (s) => { s.delete(id); }),

  clear: () => tx('photos', 'readwrite', (s) => { s.clear(); }),
};

/* ---------------- species overrides ---------------- */

export const overrides = {
  all: () => tx('speciesOverrides', 'readonly', (s) => wrap(s.getAll())),
  put: (rec) => tx('speciesOverrides', 'readwrite', (s) => { s.put(rec); return rec; }),
  remove: (id) => tx('speciesOverrides', 'readwrite', (s) => { s.delete(id); }),
  clear: () => tx('speciesOverrides', 'readwrite', (s) => { s.clear(); }),
};

/* ---------------- meta ---------------- */

export const meta = {
  get: (key) => tx('meta', 'readonly', (s) => wrap(s.get(key))).then((r) => (r ? r.value : undefined)),
  set: (key, value) => tx('meta', 'readwrite', (s) => { s.put({ key, value }); }),
};

/* ---------------- storage estimate ---------------- */

export async function storageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}

/** 端末の掃除で写真が消えないよう永続化を要求（拒否されても実害はない） */
export async function requestPersist() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
