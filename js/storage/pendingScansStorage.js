/**
 * ContiFor - Gestione Scatti e Foto in Sospeso (Pending Scans Storage)
 * 
 * Conserva le foto acquisite quando Gemini Vision è congestionato (Rate Limit 429)
 * o quando l'utente naviga tra schede o chiude l'app.
 * Utilizza IndexedDB con fallback localStorage per garantire persistenza illimitata senza quote ridotte.
 */

const DB_NAME = 'contifor_db';
const DB_VERSION = 1;
const STORE_NAME = 'pending_scans';
const LS_FALLBACK_KEY = 'contifor_pending_scans_fallback';

export class PendingScansStorage {
  static dbPromise = null;

  static getDB() {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }

      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        };

        request.onsuccess = (e) => {
          resolve(e.target.result);
        };

        request.onerror = (e) => {
          console.warn('IndexedDB non accessibile, fallback su localStorage:', e);
          resolve(null);
        };
      } catch (err) {
        console.warn('Errore apertura IndexedDB:', err);
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  static async getAll() {
    try {
      const db = await this.getDB();
      if (db) {
        return new Promise((resolve) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.getAll();
          req.onsuccess = () => {
            const list = req.result || [];
            list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            resolve(list);
          };
          req.onerror = () => resolve(this._getFallback());
        });
      }
    } catch (e) {
      console.warn('Errore lettura IndexedDB:', e);
    }
    return this._getFallback();
  }

  static async getById(id) {
    if (!id) return null;
    try {
      const db = await this.getDB();
      if (db) {
        return new Promise((resolve) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(this._getByIdFallback(id));
        });
      }
    } catch (e) {
      console.warn('Errore recupero da IndexedDB:', e);
    }
    return this._getByIdFallback(id);
  }

  static async save(scanData) {
    if (!scanData.id) {
      scanData.id = 'scan_pending_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    }
    if (!scanData.createdAt) {
      scanData.createdAt = new Date().toISOString();
    }
    scanData.updatedAt = new Date().toISOString();

    try {
      const db = await this.getDB();
      if (db) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(scanData);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
        return scanData;
      }
    } catch (e) {
      console.warn('Errore salvataggio IndexedDB:', e);
    }

    this._saveFallback(scanData);
    return scanData;
  }

  static async delete(id) {
    if (!id) return;
    try {
      const db = await this.getDB();
      if (db) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.delete(id);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      }
    } catch (e) {
      console.warn('Errore cancellazione IndexedDB:', e);
    }
    this._deleteFallback(id);
  }

  static async count() {
    const list = await this.getAll();
    return list.length;
  }

  static async clear() {
    try {
      const db = await this.getDB();
      if (db) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.clear();
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      }
    } catch (e) {
      console.warn('Errore pulizia IndexedDB:', e);
    }
    try {
      localStorage.removeItem(LS_FALLBACK_KEY);
    } catch (e) {}
  }

  // --- METODI DI FALLBACK LOCALSTORAGE ---
  static _getFallback() {
    try {
      const raw = localStorage.getItem(LS_FALLBACK_KEY);
      const list = raw ? JSON.parse(raw) : [];
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return list;
    } catch (e) {
      return [];
    }
  }

  static _getByIdFallback(id) {
    const list = this._getFallback();
    return list.find(s => s.id === id) || null;
  }

  static _saveFallback(scanData) {
    try {
      const list = this._getFallback();
      const idx = list.findIndex(s => s.id === scanData.id);
      if (idx !== -1) {
        list[idx] = scanData;
      } else {
        list.unshift(scanData);
      }
      localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn('Memoria fallback esaurita:', e);
    }
  }

  static _deleteFallback(id) {
    try {
      const list = this._getFallback().filter(s => s.id !== id);
      localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(list));
    } catch (e) {}
  }
}
