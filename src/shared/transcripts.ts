/**
 * IndexedDB-backed transcript store.
 *
 * Why IDB and not chrome.storage.local?
 *   chrome.storage.local has a 5 MB quota — fine for settings, NOT for transcripts.
 *   A 30-min call produces ~30–80 KB. 100 calls = 8 MB. Quickly overflows.
 *   IDB allows ~50% of available disk (typically GBs).
 *
 * Why no `idb` package?
 *   Raw IndexedDB API works fine for our small surface. Avoids extra dependency.
 */
import type { Transcript, TranscriptSegment, ContactInfo, CallDirection } from './types';

const DB_NAME = 'twilio-dialer';
const DB_VERSION = 1;
const TRANSCRIPTS_STORE = 'transcripts';
const PREFS_STORE = 'prefs';

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TRANSCRIPTS_STORE)) {
        const store = db.createObjectStore(TRANSCRIPTS_STORE, { keyPath: 'callSid' });
        store.createIndex('byDate', 'startedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(PREFS_STORE)) {
        db.createObjectStore(PREFS_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode, stores: string | string[]): IDBTransaction {
  return db.transaction(stores, mode);
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Transcript CRUD ──────────────────────────────────────────────

export const transcripts = {
  async put(t: Transcript): Promise<void> {
    const db = await openDb();
    const t1 = tx(db, 'readwrite', TRANSCRIPTS_STORE);
    t1.objectStore(TRANSCRIPTS_STORE).put(t);
    return new Promise((resolve, reject) => {
      t1.oncomplete = () => resolve();
      t1.onerror = () => reject(t1.error);
      t1.onabort = () => reject(t1.error);
    });
  },

  async get(callSid: string): Promise<Transcript | null> {
    const db = await openDb();
    const t1 = tx(db, 'readonly', TRANSCRIPTS_STORE);
    const r = await reqAsPromise(t1.objectStore(TRANSCRIPTS_STORE).get(callSid) as IDBRequest<Transcript | undefined>);
    return r ?? null;
  },

  /** List most-recent-first, limited. */
  async list(limit = 100): Promise<Transcript[]> {
    const db = await openDb();
    const t1 = tx(db, 'readonly', TRANSCRIPTS_STORE);
    const idx = t1.objectStore(TRANSCRIPTS_STORE).index('byDate');
    // Cursor in reverse direction (most recent first).
    return new Promise((resolve, reject) => {
      const out: Transcript[] = [];
      const cur = idx.openCursor(null, 'prev');
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || out.length >= limit) { resolve(out); return; }
        out.push(c.value as Transcript);
        c.continue();
      };
      cur.onerror = () => reject(cur.error);
    });
  },

  /** Naive case-insensitive substring search across all transcripts. */
  async search(query: string, limit = 50): Promise<Transcript[]> {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const all = await this.list(1000);
    const out: Transcript[] = [];
    for (const t of all) {
      if (out.length >= limit) break;
      if (t.segments.some((s) => s.text.toLowerCase().includes(q))) out.push(t);
    }
    return out;
  },

  async delete(callSid: string): Promise<void> {
    const db = await openDb();
    const t1 = tx(db, 'readwrite', TRANSCRIPTS_STORE);
    t1.objectStore(TRANSCRIPTS_STORE).delete(callSid);
    return new Promise((resolve, reject) => {
      t1.oncomplete = () => resolve();
      t1.onerror = () => reject(t1.error);
    });
  },

  async exportAll(): Promise<Transcript[]> {
    return this.list(10_000);
  },
};

// ── Prefs (non-Settings runtime data — FileSystemDirectoryHandle, etc.) ──

export const prefs = {
  async set<T = unknown>(key: string, value: T): Promise<void> {
    const db = await openDb();
    const t1 = tx(db, 'readwrite', PREFS_STORE);
    t1.objectStore(PREFS_STORE).put(value as unknown as IDBValidKey, key);
    return new Promise((resolve, reject) => {
      t1.oncomplete = () => resolve();
      t1.onerror = () => reject(t1.error);
    });
  },

  async get<T = unknown>(key: string): Promise<T | null> {
    const db = await openDb();
    const t1 = tx(db, 'readonly', PREFS_STORE);
    const r = await reqAsPromise(t1.objectStore(PREFS_STORE).get(key) as IDBRequest<T | undefined>);
    return (r ?? null) as T | null;
  },

  async remove(key: string): Promise<void> {
    const db = await openDb();
    const t1 = tx(db, 'readwrite', PREFS_STORE);
    t1.objectStore(PREFS_STORE).delete(key);
    return new Promise((resolve, reject) => {
      t1.oncomplete = () => resolve();
      t1.onerror = () => reject(t1.error);
    });
  },
};

// ── Helpers ──────────────────────────────────────────────────────

export function buildTranscript(
  callSid: string,
  segments: TranscriptSegment[],
  meta: {
    startedAt: number;
    endedAt: number;
    direction: CallDirection;
    remoteNumber: string;
    contactSnapshot?: ContactInfo;
  },
): Transcript {
  return {
    callSid,
    segments,
    ...meta,
    createdAt: Date.now(),
  };
}
