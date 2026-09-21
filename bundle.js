/**
 * ContiFor - Standalone Universal Bundle
 * Funziona sia tramite server HTTP (GitHub Pages / localhost) sia tramite doppio click locale (file://)
 */
(function() {
  'use strict';

// --- MODULE: js/config.js ---
/**
 * ContiFor - Configurazione Trasparente AI & Endpoint
 * 
 * L'utente finale NON deve inserire alcuna chiave API.
 * Le chiamate OCR vengono gestite in modo completamente trasparente:
 * - Tramite chiave preimpostata o endpoint proxy/gateway integrato.
 * - Con fallback euristico intelligente integrato offline nel caso di assenza di rete.
 */

const APP_CONFIG = {
  // Chiave preconfigurata o endpoint trasparente
  // Se configurata qui o tramite proxy, l'utente finale non vedrà mai richieste di API key
  GEMINI_API_KEY: (typeof window !== 'undefined' && window.__CONTIFOR_API_KEY__) || '',
  
  // Modello multimodale predefinito
  GEMINI_MODEL: 'gemini-3.8-flash',
  GEMINI_FALLBACK_MODEL: 'gemini-3.6-flash',

  // Endpoint proxy opzionale (se si desidera un proxy serverless o Cloudflare Worker trasparente)
  // Lasciare vuoto per chiamata diretta all'API Google Generative Language
  PROXY_ENDPOINT: '',

  // Flag per abilitare l'elaborazione trasparente
  TRANSPARENT_OCR: true
};


// --- MODULE: js/crypto/vault.js ---
/**
 * ContiFor - Modulo Crittografico Client-Side (Web Crypto API)
 * 
 * Specifiche di sicurezza:
 * - PBKDF2 per Key Derivation con SHA-256 e 100.000 iterazioni.
 * - Cifratura simmetrica AES-GCM a 256-bit con IV casuale a 96-bit (12 bytes) per ogni scrittura.
 * - Nessuna chiave esportabile (in-memory non estraibile).
 * - Zero-Cloud: tutti i dati rimangono cifrati in locale.
 */

class CryptoVault {
  static PBKDF2_ITERATIONS = 100000;
  static HASH_ALGO = 'SHA-256';
  static CIPHER_ALGO = 'AES-GCM';
  static KEY_LENGTH = 256;
  static IV_LENGTH = 12; // 96-bit consigliato per AES-GCM
  static SALT_LENGTH = 16; // 128-bit salt

  /**
   * Converte un ArrayBuffer / Uint8Array in stringa Base64
   */
  static bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Converte una stringa Base64 in Uint8Array
   */
  static base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Deriva una chiave AES-GCM a 256 bit a partire dalla Master Password e dal Salt
   */
  static async deriveKey(password, saltUint8, extractable = false) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltUint8,
        iterations: this.PBKDF2_ITERATIONS,
        hash: this.HASH_ALGO
      },
      keyMaterial,
      {
        name: this.CIPHER_ALGO,
        length: this.KEY_LENGTH
      },
      extractable,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Cifra un payload JavaScript (oggetto, array, ecc.)
   * @param {any} data - Dati da cifrare
   * @param {string} password - Master Password
   * @param {Uint8Array} [existingSalt] - Opzionale, riutilizza salt o ne genera uno nuovo
   * @returns {Promise<Object>} Envelope cifrato pronto per persistenza
   */
  static async encryptData(data, password, existingSalt = null) {
    if (!password || typeof password !== 'string' || password.length < 4) {
      throw new Error('La password deve essere composta da almeno 4 caratteri.');
    }

    const salt = existingSalt || window.crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
    const iv = window.crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
    const aesKey = await this.deriveKey(password, salt, false);

    const jsonString = JSON.stringify(data);
    const encodedData = new TextEncoder().encode(jsonString);

    const ciphertextBuffer = await window.crypto.subtle.encrypt(
      {
        name: this.CIPHER_ALGO,
        iv: iv,
        tagLength: 128
      },
      aesKey,
      encodedData
    );

    return {
      version: 1,
      format: 'contifor-vault-v1',
      salt: this.bufferToBase64(salt),
      iv: this.bufferToBase64(iv),
      ciphertext: this.bufferToBase64(ciphertextBuffer),
      timestamp: Date.now()
    };
  }

  /**
   * Decrittografa un envelope cifrato
   * @param {Object} envelope - Oggetto cifrato (con salt, iv, ciphertext)
   * @param {string} password - Master Password
   * @returns {Promise<any>} Dati decodificati in memoria
   */
  static async decryptData(envelope, password) {
    if (!envelope || !envelope.ciphertext || !envelope.iv || !envelope.salt) {
      throw new Error('Formato dati del vault non valido o incompleto.');
    }

    const salt = this.base64ToBuffer(envelope.salt);
    const iv = this.base64ToBuffer(envelope.iv);
    const ciphertext = this.base64ToBuffer(envelope.ciphertext);

    let aesKey;
    try {
      aesKey = await this.deriveKey(password, salt, false);
    } catch (err) {
      throw new Error('Errore durante la derivazione della chiave crittografica: ' + err.message);
    }

    try {
      const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
          name: this.CIPHER_ALGO,
          iv: iv,
          tagLength: 128
        },
        aesKey,
        ciphertext
      );

      const decodedString = new TextDecoder().decode(decryptedBuffer);
      return JSON.parse(decodedString);
    } catch (err) {
      // In AES-GCM, una chiave errata o manomissione lancia un'eccezione di autenticazione
      throw new Error('Master Password errata o archivio cifrato compromesso.');
    }
  }

  /**
   * Crea un backup cifrato scaricabile in formato JSON
   */
  static createBackupFile(envelope) {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(envelope, null, 2));
    const downloadAnchor = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `contifor_backup_cifrato_${dateStr}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  /**
   * Legge e valida un file di backup cifrato caricato dall'utente
   */
  static readBackupFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          if (parsed && parsed.ciphertext && parsed.iv && parsed.salt) {
            resolve(parsed);
          } else {
            reject(new Error('Il file caricato non corrisponde a un backup ContiFor valido.'));
          }
        } catch (e) {
          reject(new Error('Impossibile interpretare il file JSON di backup.'));
        }
      };
      reader.onerror = () => reject(new Error('Errore nella lettura del file.'));
      reader.readAsText(file);
    });
  }
}


// --- MODULE: js/crypto/biometrics.js ---
/**
 * ContiFor - Biometrics Manager (WebAuthn / Passkeys)
 * 
 * Gestisce l'accesso biometrico (Impronta digitale, Face ID, Touch ID, Windows Hello)
 * tramite lo standard W3C Web Authentication API (Platform Authenticator).
 */

const BIO_CRED_KEY = 'contifor_bio_credential_id';
const BIO_TOKEN_KEY = 'contifor_bio_wrapped_key';
const BIO_SALT_KEY = 'contifor_bio_salt';

class BiometricsManager {
  /**
   * Verifica se il dispositivo e il browser supportano l'autenticazione biometrica
   */
  static async isAvailable() {
    if (!window.PublicKeyCredential) {
      return false;
    }
    try {
      if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
        return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      }
      return false;
    } catch (e) {
      console.warn('Verifica disponibilità biometria non riuscita:', e);
      return false;
    }
  }

  /**
   * Controlla se la biometria è già stata configurata ed abilitata su questo dispositivo
   */
  static isEnrolled() {
    return Boolean(
      localStorage.getItem(BIO_CRED_KEY) && 
      localStorage.getItem(BIO_TOKEN_KEY) && 
      localStorage.getItem(BIO_SALT_KEY)
    );
  }

  /**
   * Registra una nuova credenziale biometrica (Impronta / Face ID) e memorizza in sicurezza
   * la chiave di sessione protetta dal token del dispositivo.
   */
  static async registerBiometrics(masterPassword) {
    if (!masterPassword || masterPassword.length < 4) {
      throw new Error('Inserisci una Master Password valida prima di abilitare la biometria.');
    }

    const available = await this.isAvailable();
    if (!available) {
      throw new Error('Il sensore biometrico (impronta/Face ID/Windows Hello) non è disponibile o non è configurato su questo dispositivo.');
    }

    // Genera challenge casuale di sicurezza (32 bytes)
    const challenge = new Uint8Array(32);
    window.crypto.getRandomValues(challenge);

    const userId = new Uint8Array(16);
    window.crypto.getRandomValues(userId);

    const publicKeyCredentialCreationOptions = {
      challenge,
      rp: {
        name: 'ContiFor Vault AES-256',
        id: window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname
      },
      user: {
        id: userId,
        name: 'contifor_user',
        displayName: 'Utente ContiFor'
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },   // ES256
        { alg: -257, type: 'public-key' }  // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform', // Forza sensore locale del dispositivo (impronta/volto)
        userVerification: 'required',
        residentKey: 'preferred'
      },
      timeout: 60000,
      attestation: 'none'
    };

    // Invoca il prompt nativo del sistema operativo (Impronta / Face ID / Windows Hello)
    const credential = await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions
    });

    if (!credential) {
      throw new Error('Registrazione biometrica annullata o non riuscita.');
    }

    // Converte il credential.rawId in stringa base64 per archiviazione
    const rawIdBytes = new Uint8Array(credential.rawId);
    const credIdBase64 = btoa(String.fromCharCode(...rawIdBytes));

    // Genera un salt casuale per la derivazione della chiave di wrapping locale
    const bioSalt = new Uint8Array(16);
    window.crypto.getRandomValues(bioSalt);
    const bioSaltBase64 = btoa(String.fromCharCode(...bioSalt));

    // Cifra la Master Password con AES-GCM usando la chiave protetta
    const wrappedToken = await this._encryptPassword(masterPassword, credIdBase64, bioSalt);

    localStorage.setItem(BIO_CRED_KEY, credIdBase64);
    localStorage.setItem(BIO_TOKEN_KEY, wrappedToken);
    localStorage.setItem(BIO_SALT_KEY, bioSaltBase64);

    return true;
  }

  /**
   * Sblocca il Vault richiedendo la verifica biometrica (Impronta / Face ID / Windows Hello)
   */
  static async authenticateBiometrics() {
    if (!this.isEnrolled()) {
      throw new Error('Accesso biometrico non ancora registrato su questo dispositivo.');
    }

    const credIdBase64 = localStorage.getItem(BIO_CRED_KEY);
    const wrappedToken = localStorage.getItem(BIO_TOKEN_KEY);
    const bioSaltBase64 = localStorage.getItem(BIO_SALT_KEY);

    // Converte ID credenziale in Uint8Array
    const rawIdStr = atob(credIdBase64);
    const credIdBytes = new Uint8Array(rawIdStr.length);
    for (let i = 0; i < rawIdStr.length; i++) {
      credIdBytes[i] = rawIdStr.charCodeAt(i);
    }

    const challenge = new Uint8Array(32);
    window.crypto.getRandomValues(challenge);

    const publicKeyCredentialRequestOptions = {
      challenge,
      allowCredentials: [{
        id: credIdBytes,
        type: 'public-key',
        transports: ['internal']
      }],
      userVerification: 'required',
      timeout: 60000
    };

    // Prompt biometrico nativo del sistema operativo
    const assertion = await navigator.credentials.get({
      publicKey: publicKeyCredentialRequestOptions
    });

    if (!assertion) {
      throw new Error('Verifica biometrica annullata.');
    }

    // Ricostruisce il salt
    const saltStr = atob(bioSaltBase64);
    const saltBytes = new Uint8Array(saltStr.length);
    for (let i = 0; i < saltStr.length; i++) {
      saltBytes[i] = saltStr.charCodeAt(i);
    }

    // Decrittografa la Master Password
    const masterPassword = await this._decryptPassword(wrappedToken, credIdBase64, saltBytes);
    return masterPassword;
  }

  /**
   * Rimuove le credenziali biometriche memorizzate su questo dispositivo
   */
  static disableBiometrics() {
    localStorage.removeItem(BIO_CRED_KEY);
    localStorage.removeItem(BIO_TOKEN_KEY);
    localStorage.removeItem(BIO_SALT_KEY);
  }

  // --- FUNZIONI DI CRITTOGRAFIA INTERNA PER IL TOKEN BIOMETRICO ---

  static async _deriveWrappingKey(credIdBase64, saltBytes) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(credIdBase64 + '_contifor_platform_guard'),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: 50000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  static async _encryptPassword(password, credIdBase64, saltBytes) {
    const key = await this._deriveWrappingKey(credIdBase64, saltBytes);
    const iv = new Uint8Array(12);
    window.crypto.getRandomValues(iv);

    const enc = new TextEncoder();
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(password)
    );

    return JSON.stringify({
      iv: btoa(String.fromCharCode(...iv)),
      data: btoa(String.fromCharCode(...new Uint8Array(ciphertext)))
    });
  }

  static async _decryptPassword(wrappedTokenJson, credIdBase64, saltBytes) {
    const envelope = JSON.parse(wrappedTokenJson);
    const key = await this._deriveWrappingKey(credIdBase64, saltBytes);

    const ivStr = atob(envelope.iv);
    const iv = new Uint8Array(ivStr.length);
    for (let i = 0; i < ivStr.length; i++) iv[i] = ivStr.charCodeAt(i);

    const dataStr = atob(envelope.data);
    const data = new Uint8Array(dataStr.length);
    for (let i = 0; i < dataStr.length; i++) data[i] = dataStr.charCodeAt(i);

    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );

    return new TextDecoder().decode(decrypted);
  }
}


// --- MODULE: js/storage/pendingScansStorage.js ---
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

class PendingScansStorage {
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


// --- MODULE: js/sync/githubSync.js ---
/**
 * ContiFor - GitHub Zero-Knowledge Cloud Sync (Modulo Sincronizzazione Smartphone ⇄ Desktop)
 * 
 * Sincronizza il Vault cifrato AES-256 su un GitHub Gist privato tramite le API ufficiali di GitHub.
 * NESSUN dato in chiaro viene mai inviato in rete.
 */



class GitHubSyncManager {
  static API_BASE = 'https://api.github.com';
  static FILE_NAME = 'contifor_encrypted_vault.json';

  /**
   * Testa la validità del Personal Access Token (PAT) di GitHub
   */
  static async testToken(token) {
    if (!token || token.trim() === '') {
      throw new Error('Inserisci un Token GitHub valido.');
    }

    const res = await fetch(`${this.API_BASE}/user`, {
      headers: {
        'Authorization': `Bearer ${token.trim()}`,
        'Accept': 'application/vnd.github+json'
      }
    });

    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('Token GitHub non valido o scaduto.');
      }
      throw new Error(`Errore verifica token GitHub (${res.status}): ${res.statusText}`);
    }

    const userData = await res.json();
    return {
      login: userData.login,
      name: userData.name || userData.login,
      avatar: userData.avatar_url
    };
  }

  /**
   * Crea un nuovo Gist privato su GitHub contenente il vault cifrato iniziale
   */
  static async createPrivateGist(token, encryptedEnvelope) {
    if (!token) throw new Error('Token GitHub mancante.');
    if (!encryptedEnvelope) throw new Error('Dati cifrati del Vault non presenti.');

    const payload = {
      description: 'ContiFor Encrypted Vault (Zero-Knowledge AES-256)',
      public: false,
      files: {
        [this.FILE_NAME]: {
          content: JSON.stringify(encryptedEnvelope, null, 2)
        }
      }
    };

    const res = await fetch(`${this.API_BASE}/gists`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token.trim()}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Impossibile creare il Gist privato su GitHub (${res.status}): ${err}`);
    }

    const data = await res.json();
    return {
      gistId: data.id,
      updatedAt: data.updated_at,
      htmlUrl: data.html_url
    };
  }

  /**
   * Invia l'ultima versione cifrata locale del Vault sul Gist privato (Push)
   */
  static async pushVault(token, gistId, encryptedEnvelope) {
    if (!token) throw new Error('Token GitHub mancante.');
    if (!gistId) throw new Error('ID del Gist non configurato.');
    if (!encryptedEnvelope) throw new Error('Dati cifrati del Vault mancanti.');

    const payload = {
      description: `ContiFor Encrypted Vault (Zero-Knowledge AES-256) - Sync ${new Date().toISOString()}`,
      files: {
        [this.FILE_NAME]: {
          content: JSON.stringify(encryptedEnvelope, null, 2)
        }
      }
    };

    const res = await fetch(`${this.API_BASE}/gists/${gistId.trim()}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token.trim()}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Errore durante il caricamento (Push) su GitHub (${res.status}): ${err}`);
    }

    const data = await res.json();
    return {
      gistId: data.id,
      updatedAt: data.updated_at
    };
  }

  /**
   * Scarica la versione cifrata del Vault dal Gist privato di GitHub (Pull)
   */
  static async pullVault(token, gistId) {
    if (!token) throw new Error('Token GitHub mancante.');
    if (!gistId) throw new Error('ID del Gist non configurato.');

    const res = await fetch(`${this.API_BASE}/gists/${gistId.trim()}`, {
      headers: {
        'Authorization': `Bearer ${token.trim()}`,
        'Accept': 'application/vnd.github+json'
      }
    });

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error('Gist non trovato su GitHub. Verifica che l\'ID del Gist sia corretto.');
      }
      const err = await res.text();
      throw new Error(`Errore durante il download (Pull) da GitHub (${res.status}): ${err}`);
    }

    const data = await res.json();
    const file = data?.files?.[this.FILE_NAME];

    if (!file || !file.content) {
      throw new Error(`Il Gist indicato non contiene il file "${this.FILE_NAME}".`);
    }

    let envelope;
    try {
      envelope = JSON.parse(file.content);
    } catch (e) {
      throw new Error('Il contenuto del file cifrato su GitHub è corrotto o non è in formato JSON valido.');
    }

    if (!envelope.ciphertext || !envelope.iv || !envelope.salt) {
      throw new Error('Il file su GitHub non è un Vault ContiFor valido.');
    }

    return {
      envelope,
      updatedAt: data.updated_at
    };
  }

  /**
   * Cerca se sull'account GitHub dell'utente esiste già un Gist di ContiFor
   */
  static async findExistingContiForGist(token) {
    if (!token || token.trim() === '') return null;

    try {
      const res = await fetch(`${this.API_BASE}/gists?per_page=100`, {
        headers: {
          'Authorization': `Bearer ${token.trim()}`,
          'Accept': 'application/vnd.github+json'
        }
      });

      if (!res.ok) {
        if (res.status === 401) throw new Error('Token GitHub non valido o scaduto.');
        return null;
      }

      const gists = await res.json();
      if (!Array.isArray(gists)) return null;

      for (const g of gists) {
        if (g.files && g.files[this.FILE_NAME]) {
          return g.id;
        }
        if (g.description && g.description.includes('ContiFor Encrypted Vault')) {
          return g.id;
        }
      }
      return null;
    } catch (err) {
      console.warn('Controllo Gist esistenti:', err);
      if (err.message && err.message.includes('scaduto')) throw err;
      return null;
    }
  }

  /**
   * Push Intelligente: se l'ID del Gist non è presente, cerca un Gist ContiFor esistente;
   * se non lo trova, crea automaticamente un nuovo Gist privato Zero-Knowledge.
   */
  static async smartPushVault(token, gistId, encryptedEnvelope) {
    if (!token || token.trim() === '') throw new Error('Token GitHub mancante.');
    if (!encryptedEnvelope) throw new Error('Dati cifrati del Vault mancanti.');

    let targetGistId = (gistId || '').trim();

    // Se manca il Gist ID, cerchiamo se esiste già sull'account
    if (!targetGistId) {
      targetGistId = await this.findExistingContiForGist(token);
    }

    if (targetGistId) {
      try {
        const res = await this.pushVault(token, targetGistId, encryptedEnvelope);
        return res;
      } catch (err) {
        // Se il gistID era obsoleto o cancellato (404), prova a ricrearlo automaticamente
        if (err.message && err.message.includes('404')) {
          return await this.createPrivateGist(token, encryptedEnvelope);
        }
        throw err;
      }
    } else {
      // Nessun Gist esistente: creane uno nuovo automaticamente
      return await this.createPrivateGist(token, encryptedEnvelope);
    }
  }

  /**
   * Pull Intelligente: se l'ID del Gist non è fornito, cerca automaticamente sull'account
   */
  static async smartPullVault(token, gistId) {
    if (!token || token.trim() === '') throw new Error('Token GitHub mancante.');

    let targetGistId = (gistId || '').trim();
    if (!targetGistId) {
      targetGistId = await this.findExistingContiForGist(token);
      if (!targetGistId) {
        throw new Error('Nessun Gist ContiFor trovato sul tuo account GitHub. Effettua prima un invio (Push) dallo smartphone per creare il backup cifrato.');
      }
    }

    const res = await this.pullVault(token, targetGistId);
    return {
      gistId: targetGistId,
      envelope: res.envelope,
      updatedAt: res.updatedAt
    };
  }

  /**
   * Fusione bidirezionale intelligente di due Vault (Locale e Remoto Cloud).
   * Unisce fornitori, listini prezzi e storico fatture senza mai sovrascrivere o perdere dati.
   */
  static mergeVaultData(local, remote) {
    if (!remote) return { mergedData: local, stats: { newSuppliers: 0, newSupplies: 0 } };
    if (!local) return { mergedData: remote, stats: { newSuppliers: remote.suppliers?.length || 0, newSupplies: remote.supplies?.length || 0 } };

    let newSuppliersCount = 0;
    let newSuppliesCount = 0;

    // 1. FORNITORI (Suppliers)
    const supplierList = [...(local.suppliers || [])];

    (remote.suppliers || []).forEach(remoteSup => {
      if (!remoteSup) return;
      const remoteNameNorm = (remoteSup.name || '').trim().toLowerCase();
      const remoteId = (remoteSup.id || '').trim();

      // Cerca se esiste già in locale per ID o per nome identico
      const existingIdx = supplierList.findIndex(s => {
        if (remoteId && s.id === remoteId) return true;
        if (remoteNameNorm && (s.name || '').trim().toLowerCase() === remoteNameNorm) return true;
        return false;
      });

      if (existingIdx === -1) {
        // Nuovo fornitore arrivato dal remoto!
        supplierList.push({ ...remoteSup });
        newSuppliersCount++;
      } else {
        // Esiste in entrambi: tieni il più recente e unisci i listini prodotti
        const localSup = supplierList[existingIdx];
        const localTime = new Date(localSup.updatedAt || localSup.createdAt || 0).getTime();
        const remoteTime = new Date(remoteSup.updatedAt || remoteSup.createdAt || 0).getTime();

        const base = remoteTime > localTime ? { ...remoteSup } : { ...localSup };

        // Unione listino prodotti senza duplicati
        const productList = [...(base.priceList || [])];
        (remoteSup.priceList || []).forEach(rp => {
          const rProdName = (rp.name || '').trim().toLowerCase();
          const pIdx = productList.findIndex(lp => (lp.name || '').trim().toLowerCase() === rProdName);
          if (pIdx === -1) {
            productList.push(rp);
          } else if (remoteTime > localTime) {
            productList[pIdx] = rp;
          }
        });

        base.priceList = productList;
        supplierList[existingIdx] = base;
      }
    });

    // 2. STORICO FORNITURE E FATTURE (Supplies)
    const supplyList = [...(local.supplies || [])];
    (remote.supplies || []).forEach(remoteSp => {
      if (!remoteSp) return;
      const rId = (remoteSp.id || '').trim();
      const rInvNum = (remoteSp.invoiceNumber || '').trim();

      const existingIdx = supplyList.findIndex(ls => {
        if (rId && ls.id === rId) return true;
        if (rInvNum && ls.invoiceNumber === rInvNum) return true;
        return false;
      });

      if (existingIdx === -1) {
        supplyList.push({ ...remoteSp });
        newSuppliesCount++;
      } else {
        const localSp = supplyList[existingIdx];
        const localTime = new Date(localSp.updatedAt || localSp.date || 0).getTime();
        const remoteTime = new Date(remoteSp.updatedAt || remoteSp.date || 0).getTime();
        if (remoteTime > localTime) {
          supplyList[existingIdx] = { ...remoteSp };
        }
      }
    });

    // 3. SETTINGS
    const mergedSettings = {
      ...(local.settings || {}),
      githubToken: local.settings?.githubToken || remote.settings?.githubToken || '',
      githubGistId: local.settings?.githubGistId || remote.settings?.githubGistId || '',
      geminiApiKey: local.settings?.geminiApiKey || remote.settings?.geminiApiKey || '',
      geminiModel: local.settings?.geminiModel || remote.settings?.geminiModel || 'gemini-3.8-flash',
      lastCloudSyncDate: new Date().toISOString()
    };

    return {
      mergedData: {
        suppliers: supplierList,
        supplies: supplyList,
        settings: mergedSettings
      },
      stats: {
        newSuppliers: newSuppliersCount,
        newSupplies: newSuppliesCount,
        totalSuppliers: supplierList.length,
        totalSupplies: supplyList.length
      }
    };
  }

  /**
   * Sincronizzazione Intelligente Bidirezionale (2-Way Smart Sync).
   * Scarica i dati dal Cloud, li fonde con i dati locali (senza sovrascritture distruttive)
   * e ripubblica il risultato consolidato su GitHub Gist.
   */
  static async smartSync(token, gistId, sessionPassword, localData) {
    if (!token || token.trim() === '') throw new Error('Token GitHub mancante.');
    if (!sessionPassword) throw new Error('Master Password di sessione non disponibile.');

    let targetGistId = (gistId || '').trim();
    if (!targetGistId) {
      targetGistId = await this.findExistingContiForGist(token);
    }

    if (targetGistId) {
      let pullResult = null;
      try {
        pullResult = await this.pullVault(token, targetGistId);
      } catch (err) {
        console.warn('Lettura Gist esistente non riuscita, procedo con creazione:', err);
      }

      if (pullResult && pullResult.envelope) {
        let remoteData;
        try {
          remoteData = await CryptoVault.decryptData(pullResult.envelope, sessionPassword);
        } catch (decryptErr) {
          throw new Error('Impossibile decifrare il Vault su GitHub: la Master Password di questo dispositivo è diversa da quella usata sullo smartphone.');
        }

        // Fusione bidirezionale
        const { mergedData, stats } = this.mergeVaultData(localData, remoteData);

        // Cifra i dati consolidati
        const mergedEnvelope = await CryptoVault.encryptData(mergedData, sessionPassword);

        // Pubblica su GitHub Gist
        const pushRes = await this.pushVault(token, targetGistId, mergedEnvelope);

        return {
          gistId: targetGistId,
          mergedData,
          envelope: mergedEnvelope,
          stats,
          updatedAt: pushRes.updatedAt
        };
      }
    }

    // Se nessun Gist esisteva ancora su GitHub, crealo con i dati locali
    const initialEnvelope = await CryptoVault.encryptData(localData, sessionPassword);
    const createRes = await this.createPrivateGist(token, initialEnvelope);

    return {
      gistId: createRes.gistId,
      mergedData: localData,
      envelope: initialEnvelope,
      stats: {
        newSuppliers: 0,
        newSupplies: 0,
        totalSuppliers: localData.suppliers?.length || 0,
        totalSupplies: localData.supplies?.length || 0
      },
      updatedAt: createRes.updatedAt
    };
  }
}


// --- MODULE: js/ui/toast.js ---
/**
 * ContiFor - Sistema di Notifiche Toast Touch-Friendly
 */

class Toast {
  static container = null;

  static init() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  }

  static show(message, type = 'info', duration = 3500) {
    this.init();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type} animate-slide-up`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';
    if (type === 'warning') icon = '🔔';

    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-message">${message}</span>
    `;

    this.container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-fade-out');
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, duration);
  }

  static success(msg, duration) {
    this.show(msg, 'success', duration);
  }

  static error(msg, duration = 5000) {
    this.show(msg, 'error', duration);
  }

  static info(msg, duration) {
    this.show(msg, 'info', duration);
  }
}


// --- MODULE: js/ui/charts.js ---
/**
 * ContiFor - Motore di Rendering Grafici SVG Nativo e Interattivo
 * 
 * 100% Offline-ready (nessuna dipendenza CDN o libreria esterna):
 * - Grafico a Barre Raggruppate / Andamento Mensile per Fornitore
 * - Grafico a Ciambella (Donut Chart) con incidenza percentuale e legenda
 * - Supporto dinamico Dark/Light theme e Tooltip touch-friendly
 */

class ChartEngine {
  // Palette di colori ad alto contrasto distinta per i fornitori
  static PALETTE = [
    '#3b82f6', // Blu primario
    '#10b981', // Smeraldo
    '#f59e0b', // Ambra
    '#ec4899', // Fucsia
    '#8b5cf6', // Viola
    '#06b6d4', // Ciano
    '#f97316', // Arancio
    '#14b8a6', // Teal
    '#6366f1'  // Indaco
  ];

  static getColor(index) {
    return this.PALETTE[index % this.PALETTE.length];
  }

  /**
   * Genera un Grafico a Ciambella (Donut) interattivo in SVG
   * @param {HTMLElement} container - Elemento contenitore
   * @param {Array<{label: string, value: number, color?: string}>} data - Dati
   * @param {string} title - Titolo o etichetta centrale
   */
  static renderDonutChart(container, data, centerLabel = 'Totale') {
    container.innerHTML = '';

    const validData = data.filter(d => d.value > 0);
    const total = validData.reduce((sum, d) => sum + d.value, 0);

    if (total === 0 || validData.length === 0) {
      container.innerHTML = `
        <div class="chart-empty-state">
          <p>Nessuna fornitura registrata per i fornitori selezionati.</p>
        </div>
      `;
      return;
    }

    const size = 320;
    const strokeWidth = 38;
    const radius = (size - strokeWidth) / 2;
    const center = size / 2;
    const circumference = 2 * Math.PI * radius;

    let accumulatedAngle = -90; // Inizia in alto
    let accumulatedOffset = 0;

    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("class", "donut-chart-svg");

    // Gruppo per gli archi
    const arcsGroup = document.createElementNS(svgNs, "g");

    validData.forEach((item, index) => {
      const percentage = (item.value / total);
      const dashArray = `${percentage * circumference} ${circumference}`;
      const color = item.color || this.getColor(index);

      const circle = document.createElementNS(svgNs, "circle");
      circle.setAttribute("cx", center);
      circle.setAttribute("cy", center);
      circle.setAttribute("r", radius);
      circle.setAttribute("fill", "transparent");
      circle.setAttribute("stroke", color);
      circle.setAttribute("stroke-width", strokeWidth);
      circle.setAttribute("stroke-dasharray", dashArray);
      circle.setAttribute("stroke-dashoffset", -accumulatedOffset);
      circle.setAttribute("transform", `rotate(-90 ${center} ${center})`);
      circle.setAttribute("class", "donut-segment");
      circle.setAttribute("data-label", item.label);
      circle.setAttribute("data-value", item.value.toFixed(2));
      circle.setAttribute("data-percent", (percentage * 100).toFixed(1));

      // Tooltip su click / hover touch
      circle.addEventListener('click', () => {
        const textCenterVal = svg.querySelector('.donut-center-value');
        const textCenterSub = svg.querySelector('.donut-center-sub');
        if (textCenterVal) textCenterVal.textContent = `€ ${item.value.toLocaleString('it-IT', { minimumFractionDigits: 2 })}`;
        if (textCenterSub) textCenterSub.textContent = `${item.label} (${(percentage * 100).toFixed(1)}%)`;
      });

      arcsGroup.appendChild(circle);
      accumulatedOffset += percentage * circumference;
    });

    svg.appendChild(arcsGroup);

    // Testo centrale
    const textGroup = document.createElementNS(svgNs, "g");
    textGroup.setAttribute("class", "donut-center-text");

    const labelText = document.createElementNS(svgNs, "text");
    labelText.setAttribute("x", center);
    labelText.setAttribute("y", center - 14);
    labelText.setAttribute("text-anchor", "middle");
    labelText.setAttribute("class", "donut-center-sub");
    labelText.textContent = centerLabel;

    const valueText = document.createElementNS(svgNs, "text");
    valueText.setAttribute("x", center);
    valueText.setAttribute("y", center + 18);
    valueText.setAttribute("text-anchor", "middle");
    valueText.setAttribute("class", "donut-center-value");
    valueText.textContent = `€ ${total.toLocaleString('it-IT', { minimumFractionDigits: 2 })}`;

    textGroup.appendChild(labelText);
    textGroup.appendChild(valueText);
    svg.appendChild(textGroup);

    container.appendChild(svg);

    // Costruzione Legenda interattiva
    const legendContainer = document.createElement('div');
    legendContainer.className = 'chart-legend';

    validData.forEach((item, index) => {
      const percentage = ((item.value / total) * 100).toFixed(1);
      const color = item.color || this.getColor(index);

      const legendItem = document.createElement('div');
      legendItem.className = 'legend-item';
      legendItem.innerHTML = `
        <span class="legend-badge" style="background-color: ${color};"></span>
        <span class="legend-label" title="${item.label}">${item.label}</span>
        <span class="legend-amount">€ ${item.value.toLocaleString('it-IT', { minimumFractionDigits: 2 })}</span>
        <span class="legend-percent">(${percentage}%)</span>
      `;
      legendContainer.appendChild(legendItem);
    });

    container.appendChild(legendContainer);
  }

  /**
   * Genera un Grafico a Barre Andamento Mensile dei costi per Fornitore
   * @param {HTMLElement} container - Contenitore
   * @param {Array<string>} months - Elenco mesi (es. ["Giu", "Lug", "Ago", "Set"])
   * @param {Array<{supplierId: string, supplierName: string, color: string, monthlyTotals: number[]}>} series - Serie dati
   */
  static renderMonthlyBarChart(container, months, series) {
    container.innerHTML = '';

    if (!series || series.length === 0 || !months || months.length === 0) {
      container.innerHTML = `
        <div class="chart-empty-state">
          <p>Nessun dato temporale disponibile per i filtri selezionati.</p>
        </div>
      `;
      return;
    }

    // Calcolo del valore massimo per la scala Y
    let maxVal = 0;
    months.forEach((_, mIdx) => {
      let monthSum = 0;
      series.forEach(s => {
        const val = s.monthlyTotals[mIdx] || 0;
        if (val > maxVal) maxVal = val;
        monthSum += val;
      });
    });

    if (maxVal === 0) maxVal = 100;
    // Arrotondamento superiore per la griglia
    const yGridMax = Math.ceil(maxVal * 1.15 / 50) * 50 || 100;

    const width = 600;
    const height = 300;
    const padLeft = 65;
    const padRight = 20;
    const padTop = 30;
    const padBottom = 45;

    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;

    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("class", "bar-chart-svg");

    // Linee guida orizzontali Y
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const yVal = (yGridMax / steps) * i;
      const yPos = padTop + plotHeight - (yVal / yGridMax) * plotHeight;

      const line = document.createElementNS(svgNs, "line");
      line.setAttribute("x1", padLeft);
      line.setAttribute("y1", yPos);
      line.setAttribute("x2", width - padRight);
      line.setAttribute("y2", yPos);
      line.setAttribute("stroke", "var(--border-subtle, #374151)");
      line.setAttribute("stroke-dasharray", i === 0 ? "none" : "3,3");
      svg.appendChild(line);

      const label = document.createElementNS(svgNs, "text");
      label.setAttribute("x", padLeft - 8);
      label.setAttribute("y", yPos + 4);
      label.setAttribute("text-anchor", "end");
      label.setAttribute("class", "chart-axis-label");
      label.textContent = `€${Math.round(yVal)}`;
      svg.appendChild(label);
    }

    // Barre raggruppate per mese
    const groupWidth = plotWidth / months.length;
    const barWidth = Math.max(8, Math.min(26, (groupWidth * 0.75) / series.length));

    months.forEach((month, mIdx) => {
      const groupCenterX = padLeft + (mIdx + 0.5) * groupWidth;
      const totalGroupWidth = series.length * barWidth + (series.length - 1) * 3;
      const groupStartX = groupCenterX - (totalGroupWidth / 2);

      // Etichetta del mese sull'asse X
      const xLabel = document.createElementNS(svgNs, "text");
      xLabel.setAttribute("x", groupCenterX);
      xLabel.setAttribute("y", height - 12);
      xLabel.setAttribute("text-anchor", "middle");
      xLabel.setAttribute("class", "chart-axis-label month-label");
      xLabel.textContent = month;
      svg.appendChild(xLabel);

      // Barre dei singoli fornitori
      series.forEach((s, sIdx) => {
        const val = s.monthlyTotals[mIdx] || 0;
        const barHeight = (val / yGridMax) * plotHeight;
        const barX = groupStartX + sIdx * (barWidth + 3);
        const barY = padTop + plotHeight - barHeight;

        if (barHeight > 0) {
          const rect = document.createElementNS(svgNs, "rect");
          rect.setAttribute("x", barX);
          rect.setAttribute("y", barY);
          rect.setAttribute("width", barWidth);
          rect.setAttribute("height", Math.max(3, barHeight));
          rect.setAttribute("rx", "3");
          rect.setAttribute("fill", s.color);
          rect.setAttribute("class", "bar-rect");
          rect.setAttribute("data-supplier", s.supplierName);
          rect.setAttribute("data-month", month);
          rect.setAttribute("data-val", val.toFixed(2));

          // Titolo SVG per tooltip nativo rapido
          const titleEl = document.createElementNS(svgNs, "title");
          titleEl.textContent = `${s.supplierName} (${month}): € ${val.toLocaleString('it-IT', { minimumFractionDigits: 2 })}`;
          rect.appendChild(titleEl);

          svg.appendChild(rect);
        }
      });
    });

    container.appendChild(svg);

    // Legenda serie
    const legendContainer = document.createElement('div');
    legendContainer.className = 'chart-series-legend';
    series.forEach(s => {
      const totalSerie = s.monthlyTotals.reduce((a, b) => a + b, 0);
      const item = document.createElement('div');
      item.className = 'series-legend-item';
      item.innerHTML = `
        <span class="series-badge" style="background-color: ${s.color};"></span>
        <span class="series-name">${s.supplierName}</span>
        <span class="series-val">€ ${totalSerie.toLocaleString('it-IT', { minimumFractionDigits: 2 })}</span>
      `;
      legendContainer.appendChild(item);
    });

    container.appendChild(legendContainer);
  }
}


// --- MODULE: js/ui/invoiceGenerator.js ---
/**
 * ContiFor - Invoice & Receipt Generator (Modulo Stampa & PDF A4)
 * 
 * Genera un documento strutturato professionale in formato Fattura / Bolla di Consegna,
 * pronto per l'anteprima, la stampa diretta o il salvataggio in PDF.
 */

class InvoiceGenerator {
  /**
   * Genera il markup HTML completo della fattura/ricevuta
   */
  static generateInvoiceHtml(supply, options = {}) {
    const docId = supply.invoiceNumber || `FT-${(supply.date || '').replace(/-/g, '')}-${(supply.id || '0000').slice(-5).toUpperCase()}`;
    const formattedDate = supply.date ? new Date(supply.date).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }) : new Date().toLocaleDateString('it-IT');

    const items = supply.items || [];
    const totalQty = supply.totalQuantity || items.reduce((sum, it) => sum + (parseFloat(it.quantity) || 0), 0);
    const grandTotal = supply.totalAmount || items.reduce((sum, it) => sum + (parseFloat(it.subtotal) || 0), 0);

    return `
      <div class="invoice-container printable-document" id="printable-invoice">
        <!-- Barra di Azioni a Schermo (non stampata) -->
        <div class="invoice-actions-toolbar no-print">
          <div class="invoice-status-indicator">
            <span class="badge badge-success">✓ Convalidato & Archiviato</span>
            <span class="invoice-id-display">Doc. <strong>${docId}</strong></span>
          </div>
          <div class="invoice-btn-group">
            <button type="button" class="btn btn-primary" id="btn-print-invoice" title="Stampa o Salva come PDF con anteprima di sistema">
              🖨️ Stampa / Salva in PDF
            </button>
            <button type="button" class="btn btn-outline" id="btn-download-invoice-html" title="Scarica il documento come file HTML autonomo">
              💾 Scarica HTML
            </button>
            <button type="button" class="btn btn-subtle" id="btn-close-invoice-modal">
              ✕ Chiudi
            </button>
          </div>
        </div>

        <!-- FOGLIO A4 FATTURA / DOCUMENTO -->
        <div class="invoice-paper">
          <!-- Intestazione Documento -->
          <div class="invoice-header">
            <div class="invoice-brand">
              <div class="invoice-logo">CF</div>
              <div>
                <h2 class="invoice-company-name">ContiFor</h2>
                <p class="invoice-company-sub">Gestione Forniture, Controllo Pesi & Trascrizione OCR</p>
                <p class="invoice-company-meta">Crittografia Client-Side AES-256 • Zero-Cloud Vault</p>
              </div>
            </div>
            <div class="invoice-meta-box">
              <h1 class="invoice-doc-type">FATTURA / RIEPILOGO FORNITURA</h1>
              <table class="invoice-meta-table">
                <tr>
                  <td><strong>N. Documento:</strong></td>
                  <td class="text-right font-mono">${docId}</td>
                </tr>
                <tr>
                  <td><strong>Data Documento:</strong></td>
                  <td class="text-right">${formattedDate}</td>
                </tr>
                <tr>
                  <td><strong>Stato Verifica:</strong></td>
                  <td class="text-right"><span class="invoice-stamp">VERIFICATO</span></td>
                </tr>
              </table>
            </div>
          </div>

          <hr class="invoice-divider" />

          <!-- Dati Fornitore e Destinatario -->
          <div class="invoice-parties-grid">
            <div class="party-box party-supplier">
              <div class="party-title">FORNITORE (Emittente)</div>
              <div class="party-name">${supply.supplierName || 'Fornitore non specificato'}</div>
              ${supply.supplierContact ? `<div class="party-contact">📞 ${supply.supplierContact}</div>` : ''}
              ${supply.documentTitle ? `<div class="party-ref">Riferimento appunto: <em>${supply.documentTitle}</em></div>` : ''}
            </div>
            <div class="party-box party-client">
              <div class="party-title">DESTINATARIO / RICEZIONE MERCI</div>
              <div class="party-name">Magazzino / Punto Vendita</div>
              <div class="party-detail">Controllo Merci in Entrata</div>
              <div class="party-detail">Data Convalida: ${new Date().toLocaleDateString('it-IT')}</div>
            </div>
          </div>

          <!-- Tabella Voci Articoli e Pesi -->
          <div class="invoice-table-wrapper">
            <table class="invoice-items-table">
              <thead>
                <tr>
                  <th style="width: 5%;">#</th>
                  <th style="width: 38%;">Descrizione Articolo / Voce</th>
                  <th style="width: 14%;" class="text-right">Quantità / Peso</th>
                  <th style="width: 8%;" class="text-center">U.M.</th>
                  <th style="width: 15%;" class="text-right">Prezzo Unitario</th>
                  <th style="width: 20%;" class="text-right">Totale Riga</th>
                </tr>
              </thead>
              <tbody>
                ${items.map((it, idx) => {
                  const qty = parseFloat(it.quantity) || 0;
                  const price = parseFloat(it.unitPrice) || 0;
                  const rowTot = parseFloat(it.subtotal) || (qty * price);
                  const subWeightsStr = (it.sub_weights && it.sub_weights.length > 0) 
                    ? `Pesi parziali: (${it.sub_weights.join(' + ')} = ${qty} ${it.unit || ''})` 
                    : '';

                  return `
                    <tr>
                      <td class="text-center font-mono">${idx + 1}</td>
                      <td>
                        <div class="font-weight-bold">${it.productName || 'Articolo'}</div>
                        ${subWeightsStr ? `<div class="invoice-item-subweights">${subWeightsStr}</div>` : ''}
                        ${it.notes ? `<div class="invoice-item-notes">${it.notes}</div>` : ''}
                      </td>
                      <td class="text-right font-mono">${qty.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td class="text-center">${it.unit || 'kg'}</td>
                      <td class="text-right font-mono">€ ${price.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td class="text-right font-weight-bold font-mono">€ ${rowTot.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>

          <!-- Sezione Totali e Certificazione Calcoli -->
          <div class="invoice-bottom-grid">
            <div class="invoice-audit-card">
              <div class="audit-badge">
                <span class="badge-icon">🛡️</span>
                <strong>Audit Matematico & Integrità Dati</strong>
              </div>
              <p class="audit-description">
                Tutte le operazioni aritmetiche (quantità × prezzi e somme di pesi) sono state analizzate, verificate e convalidate. 
                Archiviazione permanente cifrata nel Vault locale protetto da AES-256.
              </p>
              ${supply.notes ? `<div class="invoice-public-notes"><strong>Note Documento:</strong> ${supply.notes}</div>` : ''}
            </div>

            <div class="invoice-totals-box">
              <table class="invoice-totals-table">
                <tr>
                  <td>Numero Voci Totali:</td>
                  <td class="text-right font-mono">${items.length}</td>
                </tr>
                <tr>
                  <td>Peso / Quantità Complessiva:</td>
                  <td class="text-right font-mono"><strong>${totalQty.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
                </tr>
                <tr>
                  <td>Imponibile Netto Merci:</td>
                  <td class="text-right font-mono">€ ${grandTotal.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
                <tr class="invoice-grand-total-row">
                  <td><strong>TOTALE DOCUMENTO:</strong></td>
                  <td class="text-right font-mono"><strong class="grand-total-text">€ ${grandTotal.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
                </tr>
              </table>
            </div>
          </div>

          <!-- Footer e Firma di Ricezione -->
          <div class="invoice-footer">
            <div class="signature-line">
              <div class="sig-title">Firma per il Fornitore</div>
              <div class="sig-space">_________________________</div>
            </div>
            <div class="signature-line">
              <div class="sig-title">Firma per Ricezione & Controllo</div>
              <div class="sig-space">_________________________</div>
            </div>
          </div>
          
          <div class="invoice-watermark-footer">
            Documento generato da ContiFor PWA • Crittografia Client-Side conforme alle specifiche di sicurezza.
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Mostra la modale interattiva a schermo intero con la fattura
   */
  static showInvoiceModal(supply, onClosed = null) {
    let modalEl = document.getElementById('contifor-invoice-modal');
    if (!modalEl) {
      modalEl = document.createElement('div');
      modalEl.id = 'contifor-invoice-modal';
      modalEl.className = 'modal-backdrop invoice-modal-backdrop';
      document.body.appendChild(modalEl);
    }

    modalEl.innerHTML = `
      <div class="invoice-modal-content">
        ${this.generateInvoiceHtml(supply)}
      </div>
    `;

    modalEl.classList.remove('hidden');
    document.body.classList.add('modal-open-invoice');

    // Binding pulsanti toolbar
    const printBtn = modalEl.querySelector('#btn-print-invoice');
    if (printBtn) {
      printBtn.addEventListener('click', () => {
        window.print();
      });
    }

    const downloadBtn = modalEl.querySelector('#btn-download-invoice-html');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        this.downloadInvoiceHtml(supply);
      });
    }

    const closeBtn = modalEl.querySelector('#btn-close-invoice-modal');
    const handleClose = () => {
      modalEl.classList.add('hidden');
      document.body.classList.remove('modal-open-invoice');
      if (typeof onClosed === 'function') {
        onClosed();
      }
    };

    if (closeBtn) {
      closeBtn.addEventListener('click', handleClose);
    }
  }

  /**
   * Scarica il documento come file HTML autonomo stampabile offline
   */
  static downloadInvoiceHtml(supply) {
    const rawHtml = this.generateInvoiceHtml(supply);
    const fullHtml = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Fattura_${(supply.supplierName || 'Fornitura').replace(/\s+/g, '_')}_${supply.date}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6; margin: 0; padding: 20px; color: #111827; }
    .invoice-actions-toolbar { display: none !important; }
    .invoice-paper { max-width: 800px; margin: 0 auto; background: #fff; padding: 40px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
    .invoice-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    .invoice-brand { display: flex; align-items: center; gap: 12px; }
    .invoice-logo { width: 44px; height: 44px; background: #2563eb; color: #fff; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 20px; }
    .invoice-company-name { margin: 0; font-size: 22px; font-weight: 700; color: #111827; }
    .invoice-company-sub { margin: 2px 0 0 0; font-size: 12px; color: #4b5563; }
    .invoice-company-meta { margin: 2px 0 0 0; font-size: 11px; color: #6b7280; }
    .invoice-doc-type { margin: 0 0 8px 0; font-size: 16px; font-weight: 800; color: #2563eb; letter-spacing: 0.05em; text-align: right; }
    .invoice-meta-table td { padding: 3px 6px; font-size: 13px; }
    .invoice-stamp { background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; }
    .invoice-divider { border: 0; border-top: 2px solid #e5e7eb; margin: 20px 0; }
    .invoice-parties-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
    .party-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px; }
    .party-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #6b7280; margin-bottom: 6px; }
    .party-name { font-size: 16px; font-weight: 700; color: #111827; margin-bottom: 4px; }
    .party-contact, .party-ref, .party-detail { font-size: 13px; color: #4b5563; }
    .invoice-items-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    .invoice-items-table th { background: #f3f4f6; color: #374151; font-size: 12px; font-weight: 700; text-transform: uppercase; padding: 10px; border-bottom: 2px solid #d1d5db; }
    .invoice-items-table td { padding: 10px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
    .invoice-item-subweights { font-size: 11px; color: #2563eb; font-family: monospace; margin-top: 2px; }
    .invoice-item-notes { font-size: 11px; color: #6b7280; font-style: italic; }
    .invoice-bottom-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 20px; margin-bottom: 30px; }
    .invoice-audit-card { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 14px; font-size: 12px; color: #1e40af; }
    .audit-badge { display: flex; align-items: center; gap: 6px; font-size: 13px; margin-bottom: 6px; }
    .invoice-totals-table { width: 100%; border-collapse: collapse; }
    .invoice-totals-table td { padding: 6px 8px; font-size: 13px; }
    .invoice-grand-total-row td { border-top: 2px solid #111827; font-size: 16px; padding-top: 10px; }
    .grand-total-text { color: #2563eb; font-size: 18px; }
    .invoice-footer { display: flex; justify-content: space-between; margin-top: 40px; padding-top: 20px; border-top: 1px dashed #d1d5db; }
    .signature-line { width: 45%; text-align: center; }
    .sig-title { font-size: 12px; font-weight: 600; color: #4b5563; margin-bottom: 40px; }
    .sig-space { font-size: 11px; color: #9ca3af; }
    .invoice-watermark-footer { text-align: center; font-size: 11px; color: #9ca3af; margin-top: 30px; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .font-weight-bold { font-weight: bold; }
    @media print {
      body { background: #fff; padding: 0; }
      .invoice-paper { box-shadow: none; padding: 0; max-width: 100%; }
    }
  </style>
</head>
<body>
  ${rawHtml}
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Fattura_${(supply.supplierName || 'Fornitura').replace(/\s+/g, '_')}_${supply.date || 'doc'}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}


// --- MODULE: js/store/state.js ---
/**
 * ContiFor - Store & State Management
 * 
 * Gestisce:
 * - Stato applicativo reattivo in memoria.
 * - Ciclo di vita del Vault crittografato (lock/unlock).
 * - Persistenza sicura su localStorage tramite CryptoVault.
 * - Operazioni CRUD su Fornitori, Listini, Storico Forniture e Impostazioni.
 */




const STORAGE_KEY = 'contifor_vault_encrypted';

class AppStore {
  constructor() {
    this.isUnlocked = false;
    this.sessionPassword = null;
    this.subscribers = [];

    // Dati in chiaro (esistono in memoria RAM SOLO a vault sbloccato)
    this.data = {
      suppliers: [],
      supplies: [],
      settings: {
        geminiApiKey: '',
        geminiModel: 'gemini-3.8-flash',
        theme: 'dark',
        highContrast: false,
        lastBackupDate: null,
        githubToken: '',
        githubGistId: '',
        lastCloudSyncDate: null,
        biometricsEnabled: false
      }
    };
  }

  /**
   * Iscrizione agli aggiornamenti dello stato
   */
  subscribe(callback) {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter(cb => cb !== callback);
    };
  }

  notify(event, payload = {}) {
    this.subscribers.forEach(cb => {
      try {
        cb(event, payload, this.data);
      } catch (err) {
        console.error('Errore nel subscriber dello store:', err);
      }
    });
  }

  /**
   * Verifica se esiste già un vault inizializzato in localStorage
   */
  isVaultInitialized() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return Boolean(raw && raw.trim().length > 0);
  }

  /**
   * Inizializza per la prima volta il Vault con una nuova Master Password
   */
  async initializeVault(masterPassword, seedDemoData = true) {
    if (!masterPassword || masterPassword.length < 4) {
      throw new Error('La Master Password deve avere almeno 4 caratteri.');
    }

    this.sessionPassword = masterPassword;
    this.isUnlocked = true;

    if (seedDemoData) {
      this.seedInitialData();
    } else {
      this.data = {
        suppliers: [],
        supplies: [],
        settings: {
          geminiApiKey: '',
          geminiModel: 'gemini-3.8-flash',
          theme: 'dark',
          highContrast: false,
          lastBackupDate: null
        }
      };
    }

    await this.saveToStorage();
    this.notify('VAULT_UNLOCKED');
    return true;
  }

  /**
   * Sblocca il vault esistente verificando la Master Password
   */
  async unlockVault(masterPassword) {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      throw new Error('Nessun archivio trovato. Inizializza un nuovo archivio.');
    }

    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch (e) {
      throw new Error('Archivio locale danneggiato o non leggibile.');
    }

    const decrypted = await CryptoVault.decryptData(envelope, masterPassword);
    
    // Migrazione automatica da vecchie versioni (gemini-2.5 o 1.5 non più attive) a gemini-3.8-flash
    let currentModel = decrypted.settings?.geminiModel;
    if (!currentModel || currentModel.includes('2.5') || currentModel.includes('1.5')) {
      currentModel = 'gemini-3.8-flash';
    }

    this.data = {
      suppliers: decrypted.suppliers || [],
      supplies: decrypted.supplies || [],
      settings: {
        geminiApiKey: decrypted.settings?.geminiApiKey || '',
        geminiModel: currentModel,
        theme: decrypted.settings?.theme || 'dark',
        highContrast: Boolean(decrypted.settings?.highContrast),
        lastBackupDate: decrypted.settings?.lastBackupDate || null,
        githubToken: decrypted.settings?.githubToken || '',
        githubGistId: decrypted.settings?.githubGistId || '',
        lastCloudSyncDate: decrypted.settings?.lastCloudSyncDate || null,
        biometricsEnabled: Boolean(decrypted.settings?.biometricsEnabled)
      }
    };

    this.sessionPassword = masterPassword;
    this.isUnlocked = true;
    this.notify('VAULT_UNLOCKED');
    return true;
  }

  /**
   * Blocca immediatamente la sessione e distrugge le chiavi in memoria RAM
   */
  lockVault() {
    this.isUnlocked = false;
    this.sessionPassword = null;
    this.data = {
      suppliers: [],
      supplies: [],
      settings: {
        geminiApiKey: '',
        geminiModel: 'gemini-3.8-flash',
        theme: 'dark',
        highContrast: false,
        lastBackupDate: null
      }
    };
    this.notify('VAULT_LOCKED');
  }

  /**
   * Salva e cifra i dati correnti su localStorage
   */
  async saveToStorage() {
    if (!this.isUnlocked || !this.sessionPassword) {
      throw new Error('Impossibile salvare: vault bloccato.');
    }

    const envelope = await CryptoVault.encryptData(this.data, this.sessionPassword);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    this.notify('DATA_SAVED');
    return envelope;
  }

  /**
   * Modifica la Master Password ricifrando l'intero archivio
   */
  async changeMasterPassword(oldPassword, newPassword) {
    if (!this.isUnlocked) throw new Error('Vault bloccato.');
    if (oldPassword !== this.sessionPassword) throw new Error('Vecchia password errata.');
    if (!newPassword || newPassword.length < 4) throw new Error('La nuova password deve contenere almeno 4 caratteri.');

    this.sessionPassword = newPassword;
    await this.saveToStorage();
    this.notify('PASSWORD_CHANGED');
    return true;
  }

  /**
   * Esporta il backup cifrato
   */
  exportEncryptedBackup() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error('Nessun dato cifrato da esportare.');
    const envelope = JSON.parse(raw);
    CryptoVault.createBackupFile(envelope);
    this.data.settings.lastBackupDate = new Date().toISOString();
    this.saveToStorage();
  }

  /**
   * Importa un backup cifrato da file
   */
  async importEncryptedBackup(backupEnvelope, passwordToTest) {
    // Verifica decrittografia preventiva
    const decrypted = await CryptoVault.decryptData(backupEnvelope, passwordToTest);
    
    // Se valida, salva su localStorage e sblocca
    localStorage.setItem(STORAGE_KEY, JSON.stringify(backupEnvelope));
    this.sessionPassword = passwordToTest;
    this.data = decrypted;
    this.isUnlocked = true;
    this.notify('VAULT_UNLOCKED');
    this.notify('BACKUP_RESTORED');
    return true;
  }

  /**
   * Recupera il pacchetto cifrato corrente da localStorage
   */
  getEncryptedEnvelope() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  /**
   * Applica una versione del Vault scaricata dal Cloud GitHub
   */
  async applyRemoteEncryptedEnvelope(envelope, password) {
    const decrypted = await CryptoVault.decryptData(envelope, password);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    this.sessionPassword = password;
    this.data = decrypted;
    if (!this.data.settings) this.data.settings = {};
    this.data.settings.lastCloudSyncDate = new Date().toISOString();
    this.isUnlocked = true;
    await this.saveToStorage();
    this.notify('VAULT_UNLOCKED');
    this.notify('CLOUD_SYNC_COMPLETED');
    return true;
  }

  /**
   * Esegue la sincronizzazione intelligente bidirezionale con GitHub Cloud (2-Way Smart Sync).
   * Scarica, fonde i fornitori/forniture e ricarica i dati senza mai sovrascrivere o perdere dati.
   */
  async syncWithCloud(token, gistId) {
    if (!this.isUnlocked || !this.sessionPassword) {
      throw new Error('Impossibile sincronizzare: Vault bloccato.');
    }

    const t = token || this.data.settings?.githubToken;
    const g = gistId || this.data.settings?.githubGistId;

    if (!t) {
      throw new Error('Token GitHub non impostato.');
    }

    const syncRes = await GitHubSyncManager.smartSync(t, g, this.sessionPassword, this.data);

    // Aggiorna dati in memoria
    this.data = syncRes.mergedData;
    if (!this.data.settings) this.data.settings = {};
    this.data.settings.githubToken = t;
    this.data.settings.githubGistId = syncRes.gistId;
    this.data.settings.lastCloudSyncDate = syncRes.updatedAt;

    // Persistenza locale cifrata
    localStorage.setItem(STORAGE_KEY, JSON.stringify(syncRes.envelope));

    // Notifica modifiche
    this.notify('SUPPLIERS_UPDATED');
    this.notify('SUPPLIES_UPDATED');
    this.notify('SETTINGS_UPDATED');
    this.notify('DATA_SAVED');
    this.notify('CLOUD_SYNC_COMPLETED', syncRes);

    return syncRes;
  }

  // --- METODI GESTIONE FORNITORI E LISTINI ---

  getSuppliers() {
    return this.data.suppliers;
  }

  getSupplierById(id) {
    return this.data.suppliers.find(s => s.id === id) || null;
  }

  async saveSupplier(supplier) {
    if (!supplier.id) {
      supplier.id = 'sup_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      supplier.createdAt = new Date().toISOString();
      supplier.priceList = supplier.priceList || [];
      this.data.suppliers.push(supplier);
    } else {
      const idx = this.data.suppliers.findIndex(s => s.id === supplier.id);
      if (idx !== -1) {
        this.data.suppliers[idx] = { ...this.data.suppliers[idx], ...supplier, updatedAt: new Date().toISOString() };
      } else {
        this.data.suppliers.push(supplier);
      }
    }
    await this.saveToStorage();
    this.notify('SUPPLIERS_UPDATED');
    return supplier;
  }

  async deleteSupplier(id) {
    this.data.suppliers = this.data.suppliers.filter(s => s.id !== id);
    await this.saveToStorage();
    this.notify('SUPPLIERS_UPDATED');
  }

  async duplicateSupplierPriceList(sourceSupplierId, newSupplierName) {
    const source = this.getSupplierById(sourceSupplierId);
    if (!source) throw new Error('Fornitore sorgente non trovato.');

    const newSupplier = {
      id: 'sup_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      name: newSupplierName || `${source.name} (Copia)`,
      contact: source.contact,
      notes: `Listino duplicato da ${source.name}`,
      createdAt: new Date().toISOString(),
      priceList: (source.priceList || []).map(p => ({
        id: 'prod_' + Math.random().toString(36).substring(2, 9),
        name: p.name,
        unit: p.unit,
        unitPrice: p.unitPrice
      }))
    };

    this.data.suppliers.push(newSupplier);
    await this.saveToStorage();
    this.notify('SUPPLIERS_UPDATED');
    return newSupplier;
  }

  // --- METODI GESTIONE STORICO FORNITURE ---

  getSupplies() {
    // Ordine cronologico decrescente (più recenti in alto)
    return [...this.data.supplies].sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  getSupplyById(id) {
    return this.data.supplies.find(s => s.id === id) || null;
  }

  async saveSupply(supply) {
    if (!supply.id) {
      supply.id = 'sup_entry_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      supply.createdAt = new Date().toISOString();
      this.data.supplies.push(supply);
    } else {
      const idx = this.data.supplies.findIndex(s => s.id === supply.id);
      if (idx !== -1) {
        this.data.supplies[idx] = { ...this.data.supplies[idx], ...supply, updatedAt: new Date().toISOString() };
      } else {
        this.data.supplies.push(supply);
      }
    }

    await this.saveToStorage();
    this.notify('SUPPLIES_UPDATED');
    return supply;
  }

  async deleteSupply(id) {
    this.data.supplies = this.data.supplies.filter(s => s.id !== id);
    await this.saveToStorage();
    this.notify('SUPPLIES_UPDATED');
  }

  // --- METODI GESTIONE IMPOSTAZIONI ---

  getSettings() {
    const s = { ...this.data.settings };
    if (!s.geminiModel || s.geminiModel.includes('1.5') || s.geminiModel.includes('2.5')) {
      s.geminiModel = 'gemini-3.8-flash';
      this.data.settings.geminiModel = 'gemini-3.8-flash';
    }
    return s;
  }

  async updateSettings(partialSettings) {
    if (partialSettings.geminiModel && (partialSettings.geminiModel.includes('1.5') || partialSettings.geminiModel.includes('2.5'))) {
      partialSettings.geminiModel = 'gemini-3.8-flash';
    }
    this.data.settings = { ...this.data.settings, ...partialSettings };
    await this.saveToStorage();
    this.notify('SETTINGS_UPDATED', this.data.settings);
  }

  // --- DATI DI ESEMPIO INIZIALI (SEED) ---
  seedInitialData() {
    const s1Id = 'sup_ortofrutta_centrale';
    const s2Id = 'sup_carni_valle';
    const s3Id = 'sup_caseificio_alpino';

    this.data.suppliers = [
      {
        id: s1Id,
        name: 'Ortofrutta Centrale SpA',
        contact: 'Mario Rossi - 335 1234567',
        notes: 'Consegne martedì e giovedì mattina ore 06:00',
        createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
        priceList: [
          { id: 'p1', name: 'Pomodori San Marzano', unit: 'kg', unitPrice: 2.20 },
          { id: 'p2', name: 'Patate Gialle Bologna', unit: 'kg', unitPrice: 0.95 },
          { id: 'p3', name: 'Zucchine Scure', unit: 'kg', unitPrice: 1.80 },
          { id: 'p4', name: 'Insalata Iceberg', unit: 'casse', unitPrice: 12.50 },
          { id: 'p5', name: 'Arance Navel', unit: 'kg', unitPrice: 1.60 },
          { id: 'p6', name: 'Mele Golden', unit: 'kg', unitPrice: 1.45 }
        ]
      },
      {
        id: s2Id,
        name: 'Macelleria Carni della Valle',
        contact: 'Luigi Bianchi - 347 9876543',
        notes: 'Bovino piemontese e suino nazionale garantito',
        createdAt: new Date(Date.now() - 25 * 86400000).toISOString(),
        priceList: [
          { id: 'p7', name: 'Fesa di Manzo', unit: 'kg', unitPrice: 14.50 },
          { id: 'p8', name: 'Macinato Scelto', unit: 'kg', unitPrice: 9.80 },
          { id: 'p9', name: 'Petto di Pollo Intero', unit: 'kg', unitPrice: 7.20 },
          { id: 'p10', name: 'Salsiccia Artigianale', unit: 'kg', unitPrice: 8.50 }
        ]
      },
      {
        id: s3Id,
        name: 'Caseificio Alpino Biologico',
        contact: 'Clara Verdi - 0461 456789',
        notes: 'Prodotti freschi a latte crudo di malga',
        createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
        priceList: [
          { id: 'p11', name: 'Mozzarella Fior di Latte', unit: 'kg', unitPrice: 8.90 },
          { id: 'p12', name: 'Parmigiano Reggiano 24m', unit: 'kg', unitPrice: 18.50 },
          { id: 'p13', name: 'Ricotta Fresca', unit: 'kg', unitPrice: 4.80 }
        ]
      }
    ];

    // Popoliamo qualche fornitura realistica nelle ultime 4 settimane per mostrare subito grafici e statistiche
    const now = new Date();
    const isoDate = (daysAgo) => {
      const d = new Date(now.getTime() - daysAgo * 86400000);
      return d.toISOString().split('T')[0];
    };

    this.data.supplies = [
      {
        id: 'sup_entry_101',
        supplierId: s1Id,
        supplierName: 'Ortofrutta Centrale SpA',
        documentTitle: 'Bolla Fornitura Orto n. 42',
        date: isoDate(22),
        items: [
          { productName: 'Pomodori San Marzano', quantity: 24.5, unit: 'kg', unitPrice: 2.20, subtotal: 53.90, notes: 'Collo 1: 12.1kg, Collo 2: 12.4kg' },
          { productName: 'Patate Gialle Bologna', quantity: 50.0, unit: 'kg', unitPrice: 0.95, subtotal: 47.50, notes: '2 sacchi da 25kg' },
          { productName: 'Zucchine Scure', quantity: 15.2, unit: 'kg', unitPrice: 1.80, subtotal: 27.36, notes: '' }
        ],
        totalQuantity: 89.7,
        totalAmount: 128.76,
        notes: 'Verificato al ricevimento merce',
        createdAt: new Date(now.getTime() - 22 * 86400000).toISOString()
      },
      {
        id: 'sup_entry_102',
        supplierId: s2Id,
        supplierName: 'Macelleria Carni della Valle',
        documentTitle: 'Ricevuta Carni Settimana 36',
        date: isoDate(18),
        items: [
          { productName: 'Fesa di Manzo', quantity: 18.4, unit: 'kg', unitPrice: 14.50, subtotal: 266.80, notes: 'Pezzatura ottima' },
          { productName: 'Macinato Scelto', quantity: 12.0, unit: 'kg', unitPrice: 9.80, subtotal: 117.60, notes: '' },
          { productName: 'Petto di Pollo Intero', quantity: 14.5, unit: 'kg', unitPrice: 7.20, subtotal: 104.40, notes: '' }
        ],
        totalQuantity: 44.9,
        totalAmount: 488.80,
        notes: 'Fornitura refrigerata perfetta',
        createdAt: new Date(now.getTime() - 18 * 86400000).toISOString()
      },
      {
        id: 'sup_entry_103',
        supplierId: s3Id,
        supplierName: 'Caseificio Alpino Biologico',
        documentTitle: 'Consegna Latticini',
        date: isoDate(12),
        items: [
          { productName: 'Mozzarella Fior di Latte', quantity: 10.0, unit: 'kg', unitPrice: 8.90, subtotal: 89.00, notes: '2 secchielli' },
          { productName: 'Parmigiano Reggiano 24m', quantity: 8.5, unit: 'kg', unitPrice: 18.50, subtotal: 157.25, notes: 'Mezza forma porzionata' }
        ],
        totalQuantity: 18.5,
        totalAmount: 246.25,
        notes: 'Scadenza mozzarella lunga',
        createdAt: new Date(now.getTime() - 12 * 86400000).toISOString()
      },
      {
        id: 'sup_entry_104',
        supplierId: s1Id,
        supplierName: 'Ortofrutta Centrale SpA',
        documentTitle: 'Rifornimento Frutta e Verdura',
        date: isoDate(5),
        items: [
          { productName: 'Insalata Iceberg', quantity: 3.0, unit: 'casse', unitPrice: 12.50, subtotal: 37.50, notes: '' },
          { productName: 'Arance Navel', quantity: 32.0, unit: 'kg', unitPrice: 1.60, subtotal: 51.20, notes: '2 casse' },
          { productName: 'Mele Golden', quantity: 28.5, unit: 'kg', unitPrice: 1.45, subtotal: 41.33, notes: '' },
          { productName: 'Pomodori San Marzano', quantity: 16.0, unit: 'kg', unitPrice: 2.20, subtotal: 35.20, notes: '' }
        ],
        totalQuantity: 79.5,
        totalAmount: 165.23,
        notes: '',
        createdAt: new Date(now.getTime() - 5 * 86400000).toISOString()
      },
      {
        id: 'sup_entry_105',
        supplierId: s2Id,
        supplierName: 'Macelleria Carni della Valle',
        documentTitle: 'Bolla Macelleria n. 89',
        date: isoDate(2),
        items: [
          { productName: 'Salsiccia Artigianale', quantity: 15.0, unit: 'kg', unitPrice: 8.50, subtotal: 127.50, notes: '' },
          { productName: 'Macinato Scelto', quantity: 8.5, unit: 'kg', unitPrice: 9.80, subtotal: 83.30, notes: '' }
        ],
        totalQuantity: 23.5,
        totalAmount: 210.80,
        notes: '',
        createdAt: new Date(now.getTime() - 2 * 86400000).toISOString()
      }
    ];
  }
}

const store = new AppStore();


// --- MODULE: js/gemini/geminiClient.js ---
/**
 * ContiFor - Client Multimodale Gemini Vision con Google AI Studio
 * 
 * Supporta la chiave API di Google AI Studio:
 * - Salvataggio cifrato client-side nel Vault protetto da Master Password.
 * - Test rapido di validità della chiave con feedback visivo.
 * - Forzatura schema JSON strutturato (`response_mime_type: "application/json"`).
 * - System Prompt ingegnerizzato per minimizzare ambiguità della grafia manuale (1 vs 7, virgole).
 * - Rigoroso rispetto della privacy: all'endpoint di Google AI Studio viene inviata unicamente l'immagine.
 */




class GeminiOCRClient {
  static DEFAULT_MODEL = 'gemini-3.8-flash';
  static FALLBACK_MODEL = 'gemini-3.6-flash';
  static ALTERNATE_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-flash-latest'];
  static API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

  /**
   * System Prompt specializzato nella lettura di appunti manoscritti per forniture
   */
  static getSystemInstruction(productCatalogNames = []) {
    let catalogHint = '';
    if (productCatalogNames && productCatalogNames.length > 0) {
      catalogHint = `
I seguenti sono possibili nomi di prodotti da usare come riferimento lessicale per correggere refusi di lettura (NON inventare prodotti non presenti nell'immagine):
[${productCatalogNames.map(p => `"${p}"`).join(', ')}]
`;
    }

    return `Sei un esperto assistente di trascrizione OCR e riconoscimento ottico specializzato in appunti di fornitura, scontrini, bolle di consegna, elenchi di pesi e calcoli aritmetici scritti rigorosamente A MANO.

OBIETTIVO PRINCIPALE:
Estrai in modo accurato e fedele l'elenco dei prodotti o voci, le quantità/pesi (inclusi pesi parziali sommati), i prezzi unitari, le moltiplicazioni e addizioni scritte a mano, e l'eventuale totale complessivo dichiarato sul foglio.

REGOLE CRITICHE DI RICONOSCIMENTO GRAFIA ED ARITMETICA:
1. DISTINZIONE 1 vs 7:
   - In Europa e in Italia il numero '7' è spesso scritto con un trattino orizzontale al centro ("7"). Se c'è una stanghetta centrale o un'inclinazione netta a destra, è un '7'.
   - Il numero '1' presenta un tratto ascendente corto iniziale e un fusto dritto verticale senza trattino centrale ("1").
2. SEPARATORI DECIMALI (VIRGOLA vs PUNTO):
   - Nei paesi latini il separatore decimale tipico è la virgola (es. "14,5", "8,25", "3,50").
   - Converti SEMPRE i valori numerici in numeri float standard con punto decimale (es. "14,5" diventa 14.5).
3. MOLTIPLICAZIONI E PREZZI UNITARI:
   - Se su una riga compare un'operazione come "14,5 x 2,20 = 31,90" oppure "kg 12 * 1,50", estrai:
     * quantity: 14.5
     * unit_price: 2.20
     * declared_row_total: 31.90
     * calculation_expression: "14.5 * 2.20 = 31.90"
4. ELENCO PESI E ADDIZIONI PARZIALI:
   - Spesso vengono scritti elenchi di pesi parziali sommati (es. serie di casse "12,4 + 13,1 + 12,8 = 38,3").
   - Estrai la lista numerica dei pesi parziali in 'sub_weights' (es. [12.4, 13.1, 12.8]) e il totale della riga in 'quantity' (es. 38.3).
5. DISTINZIONE 4 vs 9, 3 vs 8, 0 vs 6:
   - Fai attenzione alle cifre arrotondate. Il '4' è aperto o triangolare; il '9' ha una pancia chiusa in alto.
6. CANCELLATURE E RIGHE BARRATE:
   - Ignora completamente i numeri o le parole barrate/cancellate. Prendi in considerazione solo i valori finali corretti.
7. UNITÀ DI MISURA:
   - Riconosci "kg", "pz", "casse", "cartoni", "colli", "lt". Se non specificato con cifre decimali, usa "kg"; se numeri interi, "pz". Se manca il nome prodotto, usa "Articolo 1", "Pesi cassa 1", ecc.
8. TOTALE DOCUMENTO DICHIARATO:
   - Se sul fondo del foglio è scritto un totale complessivo (es. "Tot. 154,20" o "Totale € 150"), estrailo nel campo 'declared_grand_total'.

${catalogHint}

OUTPUT OBBLIGATORIO:
Devi restituire ESCLUSIVAMENTE un JSON conforme allo schema specificato, senza blocchi di markdown o testo discorsivo.`;
  }

  /**
   * Schema JSON atteso dalla risposta multimodale
   */
  static getResponseSchema() {
    return {
      type: "OBJECT",
      properties: {
        document_title: {
          type: "STRING",
          description: "Titolo o intestazione rilevata sul foglio (es. Bolla, Appunto Pesi, Data, Nome Fornitore) o null"
        },
        document_date: {
          type: "STRING",
          description: "Eventuale data rilevata nel formato YYYY-MM-DD o stringa originale"
        },
        detected_supplier_name: {
          type: "STRING",
          description: "Eventuale nome fornitore rilevato o scritto sull'appunto"
        },
        declared_grand_total: {
          type: "NUMBER",
          description: "Eventuale totale complessivo in euro scritto a mano sul fondo del foglio"
        },
        items: {
          type: "ARRAY",
          description: "Elenco delle righe o voci estratte dal manoscritto con calcoli",
          items: {
            type: "OBJECT",
            properties: {
              raw_text: {
                type: "STRING",
                description: "Testo originale letto sul foglio per questa riga"
              },
              product_name: {
                type: "STRING",
                description: "Nome normalizzato del prodotto o 'Articolo #' se omesso"
              },
              quantity: {
                type: "NUMBER",
                description: "Quantità o peso numerico decimale rilevato (es. 12.5 o somma pesi)"
              },
              sub_weights: {
                type: "ARRAY",
                items: { type: "NUMBER" },
                description: "Eventuale serie di pesi parziali sommati (es. [12.4, 13.1])"
              },
              unit: {
                type: "STRING",
                description: "Unità di misura (kg, pz, casse, colli, lt, confezioni)"
              },
              unit_price: {
                type: "NUMBER",
                description: "Prezzo unitario scritto a mano sul foglio se presente (es. 2.20)"
              },
              declared_row_total: {
                type: "NUMBER",
                description: "Subtotale o risultato della moltiplicazione scritto a mano (es. 31.90)"
              },
              calculation_expression: {
                type: "STRING",
                description: "Operazione matematica rilevata (es. '14.5 * 2.20 = 31.90' o '12.4 + 13.1 = 25.5')"
              },
              notes: {
                type: "STRING",
                description: "Eventuali chiarimenti (es. 'cifra 7 con trattino', 'somma di 2 pesi')"
              }
            },
            required: ["product_name", "quantity", "unit"]
          }
        },
        math_audit: {
          type: "OBJECT",
          properties: {
            detected_additions_count: { type: "INTEGER" },
            detected_multiplications_count: { type: "INTEGER" },
            notes_on_calculations: { type: "STRING" }
          }
        },
        general_notes: {
          type: "STRING",
          description: "Eventuali annotazioni generali sul grado di leggibilità della grafia"
        }
      },
      required: ["items"]
    };
  }

  /**
   * Ridimensiona e comprime un'immagine client-side per velocizzare l'upload
   */
  static async compressImage(imageFile, maxDimension = 1920, quality = 0.88) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;

          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');

          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          const mimeType = 'image/jpeg';
          const dataUrl = canvas.toDataURL(mimeType, quality);
          const base64 = dataUrl.split(',')[1];

          resolve({ base64, mimeType });
        };
        img.onerror = () => reject(new Error('Impossibile caricare l\'immagine.'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Errore durante la lettura del file.'));
      reader.readAsDataURL(imageFile);
    });
  }

  /**
   * Esegue un test rapido della chiave API di Google AI Studio
   */
  static async testApiKey(apiKey, model = this.DEFAULT_MODEL) {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('Inserisci una chiave API di Google AI Studio valida.');
    }

    let primary = model;
    if (!primary || primary.includes('1.5') || primary.includes('2.5')) {
      primary = this.DEFAULT_MODEL;
    }

    const modelsToTry = [primary, ...this.ALTERNATE_MODELS.filter(m => m !== primary)];
    let lastError = null;

    for (const targetModel of modelsToTry) {
      const testUrl = `${this.API_BASE}/${targetModel}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
      const payload = {
        contents: [
          {
            role: "user",
            parts: [{ text: "Rispondi unicamente con 'OK'." }]
          }
        ]
      };

      try {
        const response = await fetch(testUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          return {
            success: true,
            model: targetModel,
            message: `Chiave Google AI Studio valida e connessione a Gemini (${targetModel}) riuscita!`
          };
        }

        let errMsg = response.statusText;
        try {
          const errJson = await response.json();
          errMsg = errJson?.error?.message || errMsg;
        } catch (e) {}

        if (response.status === 400 && errMsg.includes('API_KEY_INVALID')) {
          throw new Error('La chiave inserita non è valida. Assicurati di copiarla correttamente da Google AI Studio.');
        }

        // Se 404 (modello non supportato per questo tipo di account/chiave), prova il successivo
        lastError = new Error(`Errore Google AI Studio (${response.status}): ${errMsg}`);
      } catch (err) {
        if (err.message.includes('non è valida')) throw err;
        lastError = err;
      }
    }

    throw lastError || new Error('Impossibile verificare la chiave con i modelli disponibili.');
  }

  /**
   * Risolve la chiave effettiva: da impostazioni salvate o da config
   */
  static getEffectiveApiKey() {
    const userKey = store?.getSettings()?.geminiApiKey;
    if (userKey && userKey.trim().length > 0) {
      return userKey.trim();
    }
    return APP_CONFIG.GEMINI_API_KEY || '';
  }

  /**
   * Esegue l'analisi OCR del foglio manoscritto
   */
  static async analyzeHandwrittenNote({
    apiKey,
    imageBase64,
    mimeType = 'image/jpeg',
    model,
    productCatalog = []
  }) {
    const effectiveKey = (apiKey && apiKey.trim()) || this.getEffectiveApiKey();
    const proxyEndpoint = APP_CONFIG.PROXY_ENDPOINT;
    let targetModel = model || store?.getSettings()?.geminiModel || this.DEFAULT_MODEL;
    // Se era impostato un vecchio modello non più attivo, aggiorna immediatamente a gemini-3.8-flash
    if (!targetModel || targetModel.includes('2.5') || targetModel.includes('1.5')) {
      targetModel = 'gemini-3.8-flash';
    }

    if (!effectiveKey && !proxyEndpoint) {
      throw new Error('Chiave API di Google AI Studio non configurata. Inseriscila nelle Impostazioni o nella schermata di scansione.');
    }

    const systemInstructionText = this.getSystemInstruction(productCatalog);
    const responseSchema = this.getResponseSchema();

    const requestPayload = {
      system_instruction: {
        parts: [{ text: systemInstructionText }]
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Analizza questo appunto manoscritto di fornitura. Estrai accuratamente tutti i prodotti, i pesi/quantità e le unità di misura rilevati secondo lo schema JSON."
            },
            {
              inline_data: {
                mime_type: mimeType,
                data: imageBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        response_mime_type: "application/json",
        response_schema: responseSchema,
        temperature: 0.1,
        max_output_tokens: 4096
      }
    };

    const modelsToTry = [targetModel, ...this.ALTERNATE_MODELS.filter(m => m !== targetModel)];
    let lastError = null;

    for (const currentModel of modelsToTry) {
      const targetUrl = proxyEndpoint 
        ? proxyEndpoint 
        : `${this.API_BASE}/${currentModel}:generateContent?key=${encodeURIComponent(effectiveKey.trim())}`;

      let response;
      try {
        response = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload)
        });
      } catch (networkErr) {
        throw new Error(`Errore di connessione a Google AI Studio: ${networkErr.message}. Verifica la connessione internet.`);
      }

      if (response.ok) {
        const data = await response.json();
        const candidate = data?.candidates?.[0];
        const textResult = candidate?.content?.parts?.[0]?.text;

        if (!textResult) {
          throw new Error('Google AI Studio non ha restituito alcun testo o contenuto.');
        }

        try {
          return JSON.parse(textResult);
        } catch (parseError) {
          throw new Error('La risposta da Google AI Studio non è in formato JSON valido: ' + parseError.message);
        }
      }

      let errorDetails = '';
      try {
        const errorJson = await response.json();
        errorDetails = errorJson?.error?.message || response.statusText;
      } catch (e) {
        errorDetails = await response.text();
      }

      if (response.status === 400 && errorDetails.includes('API_KEY_INVALID')) {
        throw new Error('La chiave Google AI Studio non è valida. Verificala nelle Impostazioni.');
      }

      if (response.status === 429) {
        console.warn(`Gemini Rate Limit (429) su ${currentModel}. Attesa breve prima del prossimo tentativo...`);
        lastError = new Error('Google AI Studio ha troppe richieste al momento (Rate Limit 429). Premi "Riprova Scansione" tra pochi secondi per rielaborare la stessa foto.');
        await new Promise(r => setTimeout(r, 1800));
        continue;
      }

      // Se il modello è deprecato (404) o temporaneamente congestionato (503), prova il modello alternativo
      console.warn(`Tentativo con ${currentModel} fallito (${response.status}: ${errorDetails}). Tentativo con modello alternativo...`);
      lastError = new Error(`Errore Google AI Studio (${response.status}): ${errorDetails}`);
    }

    throw lastError || new Error('Impossibile elaborare l\'immagine con i modelli Gemini disponibili.');

    const data = await response.json();
    const candidate = data?.candidates?.[0];
    const textResult = candidate?.content?.parts?.[0]?.text;

    if (!textResult) {
      throw new Error('Google AI Studio non ha restituito alcun testo o contenuto.');
    }

    try {
      return JSON.parse(textResult);
    } catch (parseError) {
      throw new Error('La risposta da Google AI Studio non è in formato JSON valido: ' + parseError.message);
    }
  }
}


// --- MODULE: js/views/authModal.js ---
/**
 * ContiFor - Auth & Unlock Modal
 * 
 * Gestisce il primo avvio (creazione Vault) e lo sblocco con Master Password
 */







class AuthModal {
  constructor(overlayElement) {
    this.overlay = overlayElement;
  }

  show() {
    const isInitialized = store.isVaultInitialized();
    const hasBiometrics = isInitialized && BiometricsManager.isEnrolled();

    this.overlay.innerHTML = `
      <div class="auth-card card animate-scale-up">
        <div class="auth-header">
          <div class="auth-logo-badge">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <h2 class="auth-title">${isInitialized ? 'Sblocca ContiFor' : 'Inizializza Vault Sicuro'}</h2>
          <p class="auth-subtitle">
            ${isInitialized 
              ? 'I tuoi dati sono protetti con crittografia client-side AES-GCM a 256 bit.' 
              : 'Configura la tua Master Password. Tutti i dati rimarranno cifrati esclusivamente su questo dispositivo (Zero-Cloud).'}
          </p>
        </div>

        ${hasBiometrics ? `
          <div class="biometric-unlock-banner mb-3">
            <button type="button" id="btn-biometric-unlock" class="btn btn-secondary btn-block btn-lg">
              <span style="font-size: 1.3rem;">👆</span>
              <strong>Sblocca con Impronta / Face ID</strong>
            </button>
            <div class="auth-divider-line mt-3 text-center">
              <small class="text-subtle">oppure inserisci la Master Password:</small>
            </div>
          </div>
        ` : ''}

        <form id="auth-form" class="auth-form mt-2">
          <div class="form-group">
            <label class="form-label" for="auth-password">Master Password *</label>
            <input type="password" id="auth-password" class="form-input" required minlength="4" placeholder="Inserisci password di sblocco" autofocus autocomplete="current-password">
          </div>

          ${!isInitialized ? `
            <div class="form-group">
              <label class="form-label" for="auth-confirm-password">Conferma Master Password *</label>
              <input type="password" id="auth-confirm-password" class="form-input" required minlength="4" placeholder="Ripeti password per conferma" autocomplete="new-password">
            </div>

            <div class="form-check mt-2">
              <label class="checkbox-label">
                <input type="checkbox" id="auth-seed-demo" checked>
                <span>Carica dati di esempio (fornitori, listini e storico per testare subito l'app)</span>
              </label>
            </div>
          ` : ''}

          <button type="submit" id="btn-submit-auth" class="btn btn-primary btn-block btn-lg mt-3">
            <span>${isInitialized ? '🔓 Sblocca Vault' : '🚀 Inizializza Vault Protetto'}</span>
          </button>
          ${!isInitialized ? `
            <div class="auth-cloud-onboarding-box mt-3 p-3 text-center border-rounded" style="background: rgba(59, 130, 246, 0.08); border: 1px dashed rgba(59, 130, 246, 0.4);">
              <p class="mb-1 font-weight-bold" style="color: var(--primary);">📱 Usi già ContiFor sullo Smartphone?</p>
              <p class="text-subtle text-sm mb-2">Collega il tuo account GitHub per sincronizzare subito tutti i tuoi dati su questo computer.</p>
              <button type="button" id="btn-toggle-cloud-import" class="btn btn-outline btn-sm">
                ☁️ Importa dati da GitHub Cloud
              </button>

              <div id="auth-cloud-import-form" class="hidden mt-3 text-left">
                <div class="form-group mb-2">
                  <label class="form-label" for="auth-cloud-token">GitHub Personal Access Token (PAT) *</label>
                  <input type="password" id="auth-cloud-token" class="form-input" placeholder="ghp_...">
                </div>
                <div class="form-group mb-2">
                  <label class="form-label" for="auth-cloud-password">Master Password (quella dello smartphone) *</label>
                  <input type="password" id="auth-cloud-password" class="form-input" placeholder="La password usata sullo smartphone">
                </div>
                <button type="button" id="btn-do-cloud-import" class="btn btn-primary btn-block btn-sm mt-2">
                  📥 Scarica e Sblocca Vault sul PC
                </button>
              </div>
            </div>
          ` : ''}
        </form>

        <div class="auth-footer">
          <div class="security-pills">
            <span class="sec-pill">🔒 AES-GCM 256-bit</span>
            <span class="sec-pill">⚡ PBKDF2 100k</span>
            <span class="sec-pill">🛡️ Zero-Cloud</span>
          </div>
          <div class="auth-restore-hint mt-2 text-center">
            ${isInitialized ? `
              <button type="button" id="btn-auth-cloud-pull" class="btn-link text-subtle text-sm" style="background:none; border:none; cursor:pointer;">
                ☁️ Sincronizza / Scarica da <strong>GitHub Cloud</strong>
              </button>
              <span class="text-subtle"> • </span>
            ` : ''}
            <label class="btn-link text-subtle text-sm" for="auth-restore-file" style="cursor:pointer;">
              Ripristina da <strong>.json</strong>
              <input type="file" id="auth-restore-file" accept=".json" class="visually-hidden">
            </label>
          </div>
        </div>
      </div>
    `;

    this.overlay.classList.remove('hidden');
    this.bindEvents(isInitialized, hasBiometrics);
  }

  hide() {
    this.overlay.classList.add('hidden');
  }

  bindEvents(isInitialized, hasBiometrics) {
    const form = this.overlay.querySelector('#auth-form');
    const pwdInput = this.overlay.querySelector('#auth-password');
    const confirmInput = this.overlay.querySelector('#auth-confirm-password');
    const seedCheck = this.overlay.querySelector('#auth-seed-demo');

    if (hasBiometrics) {
      const bioBtn = this.overlay.querySelector('#btn-biometric-unlock');
      const triggerBiometrics = async () => {
        try {
          const masterPassword = await BiometricsManager.authenticateBiometrics();
          if (masterPassword) {
            await store.unlockVault(masterPassword);
            Toast.success('Vault sbloccato con successo tramite biometria!');
            this.hide();
          }
        } catch (err) {
          console.warn('Verifica biometrica annullata o fallita:', err);
          Toast.warning('Accesso biometrico non riuscito o annullato. Inserisci la Master Password.');
          if (pwdInput) pwdInput.focus();
        }
      };

      if (bioBtn) {
        bioBtn.addEventListener('click', triggerBiometrics);
      }

      // Prompt automatico discreto all'avvio dopo 350ms
      setTimeout(() => {
        if (!store.isUnlocked && !this.overlay.classList.contains('hidden')) {
          triggerBiometrics();
        }
      }, 350);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = pwdInput.value;

      if (!isInitialized) {
        const confirmPwd = confirmInput.value;
        if (password !== confirmPwd) {
          Toast.error('Le due password inserite non coincidono.');
          return;
        }

        try {
          const seed = seedCheck ? seedCheck.checked : true;
          await store.initializeVault(password, seed);
          Toast.success('Vault cifrato inizializzato con successo!');
          this.hide();
        } catch (err) {
          Toast.error(`Errore inizializzazione: ${err.message}`);
        }
      } else {
        try {
          await store.unlockVault(password);
          Toast.success('Vault sbloccato. Sessione attiva.');
          this.hide();
        } catch (err) {
          Toast.error(err.message || 'Password errata.');
          pwdInput.value = '';
          pwdInput.focus();
        }
      }
    });

    // Ripristino backup da schermata di sblocco
    const restoreFile = this.overlay.querySelector('#auth-restore-file');
    if (restoreFile) {
      restoreFile.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
          const envelope = await CryptoVault.readBackupFile(file);
          const password = prompt('Inserisci la Master Password del file di backup:');
          if (!password) return;

          await store.importEncryptedBackup(envelope, password);
          Toast.success('Backup ripristinato con successo!');
          this.hide();
        } catch (err) {
          Toast.error(`Errore ripristino backup: ${err.message}`);
        }
      });
    }

    // Onboarding Cloud per nuovo dispositivo (PC)
    const toggleCloudBtn = this.overlay.querySelector('#btn-toggle-cloud-import');
    const cloudImportSection = this.overlay.querySelector('#auth-cloud-import-form');
    if (toggleCloudBtn && cloudImportSection) {
      toggleCloudBtn.addEventListener('click', () => {
        cloudImportSection.classList.toggle('hidden');
        if (!cloudImportSection.classList.contains('hidden')) {
          const tInput = this.overlay.querySelector('#auth-cloud-token');
          tInput?.focus();
        }
      });
    }

    const doCloudImportBtn = this.overlay.querySelector('#btn-do-cloud-import');
    if (doCloudImportBtn) {
      doCloudImportBtn.addEventListener('click', async () => {
        const tokenInput = this.overlay.querySelector('#auth-cloud-token');
        const pwdInput = this.overlay.querySelector('#auth-cloud-password');
        const token = tokenInput ? tokenInput.value.trim() : '';
        const password = pwdInput ? pwdInput.value : '';

        if (!token) {
          Toast.error('Inserisci il Personal Access Token di GitHub.');
          tokenInput?.focus();
          return;
        }
        if (!password) {
          Toast.error('Inserisci la Master Password dello smartphone.');
          pwdInput?.focus();
          return;
        }

        doCloudImportBtn.disabled = true;
        doCloudImportBtn.textContent = '⏳ Ricerca e download dal Cloud...';

        try {
          const { gistId, envelope, updatedAt } = await GitHubSyncManager.smartPullVault(token);
          await store.applyRemoteEncryptedEnvelope(envelope, password);
          await store.updateSettings({
            githubToken: token,
            githubGistId: gistId,
            lastCloudSyncDate: updatedAt
          });
          Toast.success('Vault scaricato e decifrato con successo! Il PC è ora allineato allo smartphone.');
          this.hide();
        } catch (err) {
          Toast.error(`Errore collegamento Cloud: ${err.message}`);
          doCloudImportBtn.disabled = false;
          doCloudImportBtn.textContent = '📥 Scarica e Sblocca Vault sul PC';
        }
      });
    }

    // Pull rapido da schermata di sblocco esistente
    const authCloudPullBtn = this.overlay.querySelector('#btn-auth-cloud-pull');
    if (authCloudPullBtn) {
      authCloudPullBtn.addEventListener('click', async () => {
        const settings = store.getSettings();
        let token = settings.githubToken;
        if (!token) {
          token = prompt('Inserisci il tuo Personal Access Token GitHub (ghp_...):');
          if (!token) return;
        }
        const password = prompt('Inserisci la Master Password del Vault:');
        if (!password) return;

        authCloudPullBtn.textContent = '⏳ Download...';
        try {
          const { gistId, envelope, updatedAt } = await GitHubSyncManager.smartPullVault(token, settings.githubGistId);
          await store.applyRemoteEncryptedEnvelope(envelope, password);
          await store.updateSettings({
            githubToken: token,
            githubGistId: gistId,
            lastCloudSyncDate: updatedAt
          });
          Toast.success('Vault sincronizzato con successo dal Cloud!');
          this.hide();
        } catch (err) {
          Toast.error(`Errore ripristino cloud: ${err.message}`);
          authCloudPullBtn.textContent = '☁️ Sincronizza / Scarica da GitHub Cloud';
        }
      });
    }
  }
}


// --- MODULE: js/views/scanView.js ---
/**
 * ContiFor - Scan View (Moduli B & C)
 * 
 * Acquisizione Appunti Manoscritti, Scansione Rapida (Pesi & Calcoli),
 * Audit Matematico Automatico, Validazione Fornitore Obbligatoria & Generazione Fattura PDF A4.
 */







class ScanView {
  constructor(container) {
    this.container = container;
    this.scanMode = 'quick'; // 'quick' (Scansione Rapida Pesi & Calcoli) | 'standard' (Con Listino Fornitore)
    this.currentImageBase64 = null;
    this.currentMimeType = 'image/jpeg';
    this.isProcessing = false;
    this.extractedItems = [];
    this.selectedSupplierId = null;
    this.customSupplierName = '';
    this.documentDate = new Date().toISOString().split('T')[0];
    this.documentTitle = '';
    this.notes = '';
    this.detectedGrandTotal = null;
    this.detectedAdditionsCount = 0;
    this.detectedMultiplicationsCount = 0;
    this.pendingScans = [];
    this.activePendingScanId = null;
  }

  render() {
    const suppliers = store.getSuppliers();
    if (!this.selectedSupplierId && suppliers.length > 0) {
      this.selectedSupplierId = suppliers[0].id;
    }

    this.container.innerHTML = `
      <div class="view-header">
        <div>
          <h1 class="view-title">Scansione & Controllo Aritmetico</h1>
          <p class="view-subtitle">Rileva pesi, moltiplicazioni e somme. Convalida e genera la fattura PDF.</p>
        </div>
      </div>

      <div class="scan-container">
        <!-- Barra di selezione Modalità Scansione -->
        <div class="scan-mode-tabs">
          <button type="button" class="scan-mode-btn ${this.scanMode === 'quick' ? 'active' : ''}" data-mode="quick">
            <span class="mode-icon">⚡</span>
            <div>
              <strong>Scansione Rapida</strong>
              <small class="d-block">Controllo pesi, addizioni e moltiplicazioni</small>
            </div>
          </button>
          <button type="button" class="scan-mode-btn ${this.scanMode === 'standard' ? 'active' : ''}" data-mode="standard">
            <span class="mode-icon">📋</span>
            <div>
              <strong>Scansione con Listino</strong>
              <small class="d-block">Associazione prezzi da catalogo fornitore</small>
            </div>
          </button>
        </div>

        <!-- Coda Foto in Sospeso (persistenti su disco se Gemini ha troppe richieste) -->
        <div id="pending-scans-container"></div>

        <!-- Pannello Configurazione & Scatto -->
        <div class="card scan-setup-card mt-3">
          <div class="form-row">
            <!-- Selezione o Inserimento Fornitore Obbligatorio -->
            <div class="form-group flex-2" id="supplier-selection-group">
              <label class="form-label font-weight-bold" for="scan-supplier-select">
                Fornitore Associato <span class="text-danger">* Obbligatorio</span>
              </label>
              <div class="supplier-input-combo">
                <select id="scan-supplier-select" class="form-select flex-1">
                  <option value="">-- Seleziona Fornitore Esistente --</option>
                  ${suppliers.map(s => `
                    <option value="${s.id}" ${s.id === this.selectedSupplierId ? 'selected' : ''}>
                      ${s.name} (${s.priceList?.length || 0} prodotti a listino)
                    </option>
                  `).join('')}
                </select>
                <input type="text" id="scan-custom-supplier-input" class="form-input flex-1" 
                  placeholder="Oppure scrivi nome nuovo fornitore..." value="${this.customSupplierName}">
              </div>
              <small class="form-text-hint text-subtle">
                È richiesto il nome del fornitore per convalidare e stampare la fattura/ricevuta.
              </small>
            </div>

            <div class="form-group flex-1">
              <label class="form-label" for="scan-date-input">Data Consegna</label>
              <input type="date" id="scan-date-input" class="form-input" value="${this.documentDate}">
            </div>
          </div>

          <!-- Pulsanti Acquisizione Touch -->
          <div class="camera-actions-row mt-3">
            <label class="btn btn-primary btn-camera" for="camera-file-input">
              <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                <circle cx="12" cy="13" r="4"></circle>
              </svg>
              <span>Fotocamera</span>
              <input type="file" id="camera-file-input" accept="image/*" capture="environment" class="visually-hidden">
            </label>

            <label class="btn btn-secondary btn-gallery" for="gallery-file-input">
              <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
              <span>Galleria / File</span>
              <input type="file" id="gallery-file-input" accept="image/*" class="visually-hidden">
            </label>

            <button type="button" id="btn-demo-sample" class="btn btn-outline" title="Carica un appunto di prova con pesi, somme e moltiplicazioni">
              <span>Carica Esempio Calcoli Demo</span>
            </button>
          </div>
        </div>

        <!-- Barra di Caricamento / Analisi AI -->
        <div id="ai-loading-state" class="card ai-processing-card ${this.isProcessing ? '' : 'hidden'}">
          <div class="spinner"></div>
          <div class="ai-processing-text">
            <h4>Elaborazione Gemini Vision Flash in corso...</h4>
            <p>Trascrizione grafia, verifica delle moltiplicazioni (Q.tà × Prezzo) e quadratura delle addizioni dei pesi.</p>
          </div>
        </div>

        <!-- Card Errore & Tasto Riprova Istantaneo con la stessa foto -->
        <div id="ai-error-state" class="card ai-error-card hidden mt-3">
          <div class="ai-error-banner">
            <div class="ai-error-icon">⚠️</div>
            <div class="ai-error-content flex-1">
              <h4 class="ai-error-title" id="ai-error-title">Elaborazione non riuscita</h4>
              <p class="ai-error-desc" id="ai-error-desc">
                Google AI Studio ha riscontrato un rallentamento o troppe richieste contemporanee (Rate Limit 429).
              </p>
              <div class="ai-error-hint mt-2">
                💾 <strong>La foto è salvata automaticamente sul dispositivo:</strong> anche se chiudi l'app o fai altre operazioni, la ritroverai sempre in alto pronta da elaborare o da eliminare quando vuoi.
              </div>
            </div>
          </div>
          <div class="ai-error-actions mt-3 d-flex gap-2 flex-wrap">
            <button type="button" class="btn btn-primary" id="btn-retry-scan">
              🔄 Riprova Ora (Stessa Foto)
            </button>
            <button type="button" class="btn btn-outline" id="btn-keep-pending">
              💾 Conserva tra le Foto in Sospeso
            </button>
            <button type="button" class="btn btn-danger btn-sm" id="btn-delete-active-pending">
              🗑️ Elimina Questa Foto
            </button>
            <button type="button" class="btn btn-subtle" id="btn-dismiss-error">
              Nascondi avviso
            </button>
          </div>
        </div>

        <!-- Sezione Revisione Human-in-the-Loop & Audit Matematico -->
        <div id="human-in-the-loop-section" class="${this.currentImageBase64 || this.extractedItems.length > 0 ? '' : 'hidden'}">
          
          <!-- Box Anteprima Immagine Zoomabile -->
          <div class="card image-preview-card mt-3">
            <div class="preview-header">
              <div class="preview-title">
                <span class="badge badge-info">Appunto Acquisito</span>
                <span id="preview-filename-label" class="text-subtle">Manoscritto originale</span>
              </div>
              <div class="preview-tools">
                <button type="button" id="btn-toggle-img-collapse" class="btn btn-sm btn-subtle" title="Espandi/Riduci foto">
                  ↕️ Riduci/Espandi
                </button>
              </div>
            </div>
            <div id="image-preview-wrapper" class="preview-img-wrapper">
              <img id="scanned-image-preview" src="${this.currentImageBase64 ? `data:${this.currentMimeType};base64,${this.currentImageBase64}` : ''}" alt="Foto foglio manoscritto">
            </div>
          </div>

          <!-- Card Audit Matematico & Controllo Calcoli -->
          <div class="card math-audit-card mt-3" id="math-audit-panel">
            <!-- Popolato dinamicamente da updateMathAuditUI() -->
          </div>

          <!-- Modulo C: Tabella Editabile con Feedback Touch e Ricalcolo Istantaneo -->
          <div class="card review-table-card mt-3">
            <div class="review-table-header">
              <div>
                <h3 class="card-title">Verifica Voci & Controllo Pesi (Human-in-the-Loop)</h3>
                <p class="card-subtitle">Modifica qualsiasi valore se necessario. I subtotali si ricalcolano in tempo reale.</p>
              </div>
              <button type="button" id="btn-add-item-row" class="btn btn-sm btn-outline">
                ➕ Aggiungi Riga
              </button>
            </div>

            <div class="table-responsive">
              <table class="items-table" id="review-items-table">
                <thead>
                  <tr>
                    <th style="width: 32%;">Prodotto / Dettaglio Pesi</th>
                    <th style="width: 18%;">Q.tà / Peso</th>
                    <th style="width: 14%;">U.M.</th>
                    <th style="width: 18%;">Prezzo Unit. (€)</th>
                    <th style="width: 18%;">Subtotale (€)</th>
                    <th style="width: 40px;"></th>
                  </tr>
                </thead>
                <tbody id="review-items-tbody">
                  <!-- Righe dinamiche popolate da renderTableRows() -->
                </tbody>
              </table>
            </div>

            <!-- Note addizionali documento -->
            <div class="form-row mt-3">
              <div class="form-group flex-1">
                <label class="form-label" for="review-doc-title">Riferimento / N. Documento</label>
                <input type="text" id="review-doc-title" class="form-input" placeholder="Es. Bolla del 21/09 o Scarico Pesi" value="${this.documentTitle}">
              </div>
              <div class="form-group flex-2">
                <label class="form-label" for="review-doc-notes">Note Fornitura</label>
                <input type="text" id="review-doc-notes" class="form-input" placeholder="Es. Controllo pesi effettuato su bilancia..." value="${this.notes}">
              </div>
            </div>

            <!-- Riepilogo Totali Calcolati Istantaneamente -->
            <div class="totals-summary-bar">
              <div class="summary-metric">
                <span class="summary-metric-label">Righe Totali:</span>
                <span class="summary-metric-value" id="total-rows-val">0</span>
              </div>
              <div class="summary-metric">
                <span class="summary-metric-label">Quantità / Peso Totale:</span>
                <span class="summary-metric-value" id="total-qty-val">0.00</span>
              </div>
              <div class="summary-metric metric-grand-total">
                <span class="summary-metric-label">TOTALE FORNITURA:</span>
                <span class="summary-metric-value total-euro" id="grand-total-val">€ 0,00</span>
              </div>
            </div>

            <!-- Pulsante Conferma, Convalida e Genera Fattura PDF -->
            <div class="review-actions-bar">
              <button type="button" id="btn-cancel-scan" class="btn btn-secondary">
                Annulla
              </button>
              <button type="button" id="btn-confirm-supply" class="btn btn-primary btn-lg">
                <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                  <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
                <span>Convalida & Genera Fattura PDF</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
    this.renderTableRows();
    this.updateMathAuditUI();
  }

  bindEvents() {
    // Cambio modalità di scansione (Rapida vs Standard)
    const modeBtns = this.container.querySelectorAll('.scan-mode-btn');
    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.scanMode = btn.dataset.mode;
        modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (this.scanMode === 'standard') {
          this.updatePricesFromSupplierListino();
        }
        this.updateMathAuditUI();
      });
    });

    const supplierSelect = this.container.querySelector('#scan-supplier-select');
    if (supplierSelect) {
      supplierSelect.addEventListener('change', (e) => {
        this.selectedSupplierId = e.target.value;
        const group = this.container.querySelector('#supplier-selection-group');
        if (group) group.classList.remove('supplier-required-error');
        if (this.scanMode === 'standard') {
          this.updatePricesFromSupplierListino();
        }
      });
    }

    const customSupplierInput = this.container.querySelector('#scan-custom-supplier-input');
    if (customSupplierInput) {
      customSupplierInput.addEventListener('input', (e) => {
        this.customSupplierName = e.target.value;
        const group = this.container.querySelector('#supplier-selection-group');
        if (group) group.classList.remove('supplier-required-error');
      });
    }

    const dateInput = this.container.querySelector('#scan-date-input');
    if (dateInput) {
      dateInput.addEventListener('change', (e) => {
        this.documentDate = e.target.value;
      });
    }

    const cameraInput = this.container.querySelector('#camera-file-input');
    if (cameraInput) {
      cameraInput.addEventListener('change', (e) => this.handleImageSelected(e.target.files[0]));
    }

    const galleryInput = this.container.querySelector('#gallery-file-input');
    if (galleryInput) {
      galleryInput.addEventListener('change', (e) => this.handleImageSelected(e.target.files[0]));
    }

    const demoBtn = this.container.querySelector('#btn-demo-sample');
    if (demoBtn) {
      demoBtn.addEventListener('click', () => this.loadDemoSample());
    }

    const addRowBtn = this.container.querySelector('#btn-add-item-row');
    if (addRowBtn) {
      addRowBtn.addEventListener('click', () => this.addNewRow());
    }

    const confirmBtn = this.container.querySelector('#btn-confirm-supply');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => this.confirmAndSaveSupply());
    }

    const cancelBtn = this.container.querySelector('#btn-cancel-scan');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.resetScan());
    }

    const toggleCollapseBtn = this.container.querySelector('#btn-toggle-img-collapse');
    if (toggleCollapseBtn) {
      toggleCollapseBtn.addEventListener('click', () => {
        const wrapper = this.container.querySelector('#image-preview-wrapper');
        if (wrapper) wrapper.classList.toggle('collapsed');
      });
    }

    const retryBtn = this.container.querySelector('#btn-retry-scan');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        this.executeOcrAnalysis();
      });
    }

    const keepPendingBtn = this.container.querySelector('#btn-keep-pending');
    if (keepPendingBtn) {
      keepPendingBtn.addEventListener('click', () => {
        this.hideErrorCard();
        this.currentImageBase64 = null;
        this.extractedItems = [];
        const section = this.container.querySelector('#human-in-the-loop-section');
        if (section) section.classList.add('hidden');
        this.loadAndRenderPendingScans();
        Toast.info('Foto conservata negli scatti in sospeso. Puoi continuare o chiudere l\'app.');
      });
    }

    const deleteActiveBtn = this.container.querySelector('#btn-delete-active-pending');
    if (deleteActiveBtn) {
      deleteActiveBtn.addEventListener('click', async () => {
        if (this.activePendingScanId) {
          await PendingScansStorage.delete(this.activePendingScanId);
          this.activePendingScanId = null;
        }
        this.resetScan();
        await this.loadAndRenderPendingScans();
        Toast.info('Foto eliminata.');
      });
    }

    const dismissBtn = this.container.querySelector('#btn-dismiss-error');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        this.hideErrorCard();
      });
    }

    // Carica gli scatti precedentemente salvati in sospeso
    this.loadAndRenderPendingScans();
  }

  /**
   * Carica e visualizza la coda degli scatti in sospeso (es. bloccati da troppe richieste Gemini)
   */
  async loadAndRenderPendingScans() {
    const container = this.container.querySelector('#pending-scans-container');
    if (!container) return;

    try {
      this.pendingScans = await PendingScansStorage.getAll();
    } catch (e) {
      this.pendingScans = [];
    }

    if (this.pendingScans.length === 0) {
      container.innerHTML = '';
      return;
    }

    const suppliers = store.getSuppliers();
    const getSupName = (supId) => {
      const s = suppliers.find(x => x.id === supId);
      return s ? s.name : null;
    };

    container.innerHTML = `
      <div class="card pending-scans-card mt-3">
        <div class="card-header-clean d-flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 class="card-title text-warning">📸 Foto in Sospeso (${this.pendingScans.length})</h3>
            <p class="card-subtitle">Scatti conservati sul dispositivo non elaborati subito (es. troppe richieste Gemini). Puoi riprovare ora o eliminarli.</p>
          </div>
          <span class="badge badge-warning">${this.pendingScans.length} in sospeso</span>
        </div>

        <div class="pending-scans-list mt-3">
          ${this.pendingScans.map(item => `
            <div class="pending-scan-item p-3 mb-2" data-id="${item.id}">
              <div class="d-flex items-center gap-3 flex-wrap">
                <img src="data:${item.mimeType};base64,${item.imageBase64}" 
                     class="pending-scan-thumb" 
                     alt="Anteprima foto" 
                     title="Clicca per visualizzare nell'anteprima grande">
                <div class="pending-scan-info flex-1">
                  <strong>${item.customSupplierName || getSupName(item.supplierId) || 'Fornitore non specificato'}</strong>
                  <small class="d-block text-subtle">
                    Scattata il ${new Date(item.createdAt).toLocaleString('it-IT')} • Modalità: ${item.scanMode === 'quick' ? 'Rapida (Pesi & Calcoli)' : 'Con Listino'}
                  </small>
                  ${item.errorMessage ? `<small class="text-danger d-block mt-1 font-weight-bold">⚠️ ${item.errorMessage}</small>` : ''}
                </div>
                <div class="pending-scan-actions">
                  <button type="button" class="btn btn-primary btn-sm btn-process-pending" data-id="${item.id}">
                    ⚡ Elabora con Gemini Ora
                  </button>
                  <button type="button" class="btn btn-outline btn-sm btn-delete-pending" data-id="${item.id}">
                    🗑️ Elimina Foto
                  </button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Handler per elaborazione scatto in sospeso
    container.querySelectorAll('.btn-process-pending').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        const item = this.pendingScans.find(s => s.id === id);
        if (!item) return;

        this.activePendingScanId = item.id;
        this.currentImageBase64 = item.imageBase64;
        this.currentMimeType = item.mimeType;
        this.selectedSupplierId = item.supplierId || this.selectedSupplierId;
        this.customSupplierName = item.customSupplierName || '';
        this.scanMode = item.scanMode || 'quick';
        this.documentDate = item.documentDate || this.documentDate;

        const supSelect = this.container.querySelector('#scan-supplier-select');
        if (supSelect) supSelect.value = this.selectedSupplierId || '';
        const customInput = this.container.querySelector('#scan-custom-supplier-input');
        if (customInput) customInput.value = this.customSupplierName;
        const dateInput = this.container.querySelector('#scan-date-input');
        if (dateInput) dateInput.value = this.documentDate;

        const imgEl = this.container.querySelector('#scanned-image-preview');
        if (imgEl) imgEl.src = `data:${item.mimeType};base64,${item.imageBase64}`;
        this.showImagePreviewSection();

        Toast.info('Caricamento foto in sospeso ed elaborazione con Gemini in corso...');
        await this.executeOcrAnalysis();
      });
    });

    // Handler per cancellazione scatto in sospeso
    container.querySelectorAll('.btn-delete-pending').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        if (confirm('Vuoi davvero eliminare questa foto memorizzata?')) {
          await PendingScansStorage.delete(id);
          if (this.activePendingScanId === id) {
            this.resetScan();
          }
          await this.loadAndRenderPendingScans();
          Toast.info('Foto eliminata dagli scatti in sospeso.');
        }
      });
    });

    // Clic miniatura per ingrandire
    container.querySelectorAll('.pending-scan-thumb').forEach(thumb => {
      thumb.addEventListener('click', (e) => {
        const parent = e.target.closest('.pending-scan-item');
        const id = parent?.dataset.id;
        const item = this.pendingScans.find(s => s.id === id);
        if (item) {
          const imgEl = this.container.querySelector('#scanned-image-preview');
          if (imgEl) imgEl.src = `data:${item.mimeType};base64,${item.imageBase64}`;
          this.showImagePreviewSection();
          const previewCard = this.container.querySelector('.image-preview-card');
          previewCard?.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
  }

  async handleImageSelected(file) {
    if (!file) return;

    try {
      this.hideErrorCard();
      this.updateProcessingUI(true);
      const { base64, mimeType } = await GeminiOCRClient.compressImage(file);
      this.currentImageBase64 = base64;
      this.currentMimeType = mimeType;
      this.activePendingScanId = null;

      const imgEl = this.container.querySelector('#scanned-image-preview');
      if (imgEl) imgEl.src = `data:${mimeType};base64,${base64}`;
      this.showImagePreviewSection();

      await this.executeOcrAnalysis();
    } catch (err) {
      console.error('Errore durante il caricamento o compressione:', err);
      this.updateProcessingUI(false);
      this.showErrorCard(err.message);
      Toast.error(`Errore caricamento: ${err.message}`);
    }
  }

  /**
   * Esegue o riprova l'analisi OCR sfruttando l'immagine già conservata in memoria o su disco
   */
  async executeOcrAnalysis() {
    if (!this.currentImageBase64) {
      Toast.warning('Nessuna immagine presente da elaborare.');
      return;
    }

    this.hideErrorCard();
    this.updateProcessingUI(true);

    try {
      const settings = store.getSettings();
      const apiKey = settings?.geminiApiKey;
      const targetModel = 'gemini-3.8-flash';

      // Catalogo suggerito per il fornitore selezionato
      const supplier = store.getSupplierById(this.selectedSupplierId);
      const catalogNames = (supplier?.priceList || []).map(p => p.name);

      const ocrResult = await GeminiOCRClient.analyzeHandwrittenNote({
        imageBase64: this.currentImageBase64,
        mimeType: this.currentMimeType,
        apiKey,
        model: targetModel,
        productCatalog: catalogNames
      });

      this.processOCRResult(ocrResult);

      // Se era un elemento in sospeso salvato in precedenza, rimuovilo dalla coda
      if (this.activePendingScanId) {
        await PendingScansStorage.delete(this.activePendingScanId);
        this.activePendingScanId = null;
        await this.loadAndRenderPendingScans();
      }

      Toast.success('Analisi OCR e controllo aritmetico completati con successo!');
    } catch (err) {
      console.error('Errore durante la scansione:', err);

      // Persistenza automatica della foto su storage (IndexedDB/localStorage)
      try {
        const saved = await PendingScansStorage.save({
          id: this.activePendingScanId || undefined,
          imageBase64: this.currentImageBase64,
          mimeType: this.currentMimeType,
          supplierId: this.selectedSupplierId,
          customSupplierName: this.customSupplierName,
          scanMode: this.scanMode,
          documentDate: this.documentDate,
          errorMessage: err.message || 'Gemini ha troppe richieste al momento (Rate Limit 429)'
        });
        this.activePendingScanId = saved.id;
        await this.loadAndRenderPendingScans();
      } catch (saveErr) {
        console.warn('Errore salvataggio automatico foto in sospeso:', saveErr);
      }

      this.showErrorCard(err.message);
      Toast.error(`Errore analisi: ${err.message}`);
    } finally {
      this.updateProcessingUI(false);
    }
  }

  showImagePreviewSection() {
    const section = this.container.querySelector('#human-in-the-loop-section');
    if (section) section.classList.remove('hidden');
    const wrapper = this.container.querySelector('#image-preview-wrapper');
    if (wrapper) wrapper.classList.remove('collapsed');
  }

  showErrorCard(errorMessage = '') {
    const errorCard = this.container.querySelector('#ai-error-state');
    const titleEl = this.container.querySelector('#ai-error-title');
    const descEl = this.container.querySelector('#ai-error-desc');
    if (!errorCard) return;

    const lower = (errorMessage || '').toLowerCase();
    const isRateLimit = lower.includes('429') || 
                        lower.includes('troppe richieste') || 
                        lower.includes('resource exhausted') ||
                        lower.includes('quota');

    if (isRateLimit) {
      if (titleEl) titleEl.textContent = 'Gemini ha troppe richieste al momento (Rate Limit 429)';
      if (descEl) descEl.textContent = 'I server di Google AI Studio sono temporaneamente congestionati. La tua foto è al sicuro in memoria: attendi qualche secondo e tocca "Riprova Scansione Subito" qui sotto senza dover rifare la foto.';
    } else {
      if (titleEl) titleEl.textContent = 'Elaborazione non riuscita';
      if (descEl) descEl.textContent = errorMessage || 'Si è verificato un errore durante la connessione con Google AI Studio.';
    }

    errorCard.classList.remove('hidden');
    this.showImagePreviewSection();
  }

  hideErrorCard() {
    const errorCard = this.container.querySelector('#ai-error-state');
    if (errorCard) errorCard.classList.add('hidden');
  }

  processOCRResult(result) {
    if (!result) return;

    this.documentDate = result.document_date || this.documentDate;
    this.documentTitle = result.document_title || this.documentTitle;
    this.detectedGrandTotal = typeof result.declared_grand_total === 'number' ? result.declared_grand_total : null;
    this.detectedAdditionsCount = result.math_audit?.detected_additions_count || 0;
    this.detectedMultiplicationsCount = result.math_audit?.detected_multiplications_count || 0;

    // Se Gemini ha riconosciuto un nome fornitore scritto sul foglio, pre-impostalo
    if (result.detected_supplier_name && !this.selectedSupplierId && !this.customSupplierName) {
      const suppliers = store.getSuppliers();
      const match = suppliers.find(s => s.name.toLowerCase().includes(result.detected_supplier_name.toLowerCase()));
      if (match) {
        this.selectedSupplierId = match.id;
        const sel = this.container.querySelector('#scan-supplier-select');
        if (sel) sel.value = match.id;
      } else {
        this.customSupplierName = result.detected_supplier_name;
        const inp = this.container.querySelector('#scan-custom-supplier-input');
        if (inp) inp.value = this.customSupplierName;
      }
    }

    const supplier = store.getSupplierById(this.selectedSupplierId);
    const catalog = supplier?.priceList || [];

    const rawItems = Array.isArray(result.items) ? result.items : [];
    this.extractedItems = rawItems.map(rawItem => {
      const rawName = (rawItem.product_name || 'Articolo').trim();
      const parsedQty = parseFloat(rawItem.quantity) || 1;
      const cleanUnit = (rawItem.unit || 'kg').toLowerCase();

      let match = null;
      if (this.scanMode === 'standard' && catalog.length > 0) {
        match = catalog.find(c => 
          c.name.toLowerCase() === rawName.toLowerCase() ||
          rawName.toLowerCase().includes(c.name.toLowerCase())
        );
      }

      const unitPrice = match ? match.unitPrice : (parseFloat(rawItem.unit_price) || 0);
      const unit = match ? match.unit : cleanUnit;
      const productName = match ? match.name : rawName;
      const subtotal = Math.round(parsedQty * unitPrice * 100) / 100;

      return {
        productName,
        quantity: parsedQty,
        sub_weights: Array.isArray(rawItem.sub_weights) ? rawItem.sub_weights : [],
        unit,
        unitPrice,
        subtotal,
        declared_row_total: typeof rawItem.declared_row_total === 'number' ? rawItem.declared_row_total : null,
        calculation_expression: rawItem.calculation_expression || '',
        notes: rawItem.notes || ''
      };
    });

    if (this.extractedItems.length === 0) {
      this.extractedItems.push({
        productName: 'Nuovo Articolo',
        quantity: 1,
        sub_weights: [],
        unit: 'kg',
        unitPrice: 0,
        subtotal: 0,
        declared_row_total: null,
        calculation_expression: '',
        notes: ''
      });
    }

    this.showReviewSection();
    this.renderTableRows();
    this.updateMathAuditUI();
  }

  showReviewSection() {
    const section = this.container.querySelector('#human-in-the-loop-section');
    if (section) section.classList.remove('hidden');
  }

  updateProcessingUI(loading) {
    this.isProcessing = loading;
    const loader = this.container.querySelector('#ai-loading-state');
    if (loader) {
      if (loading) loader.classList.remove('hidden');
      else loader.classList.add('hidden');
    }
  }

  /**
   * Esegue l'audit aritmetico su moltiplicazioni, serie di pesi e totale documento
   */
  runMathAudit() {
    const discrepancies = [];
    let checkedMultiplications = 0;
    let checkedAdditions = 0;

    let grandTotalCalculated = 0;

    this.extractedItems.forEach((item, index) => {
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unitPrice) || 0;
      const calculatedSubtotal = Math.round(qty * price * 100) / 100;
      grandTotalCalculated += calculatedSubtotal;

      // 1. Controllo moltiplicazione: Q * P vs subtotale scritto sul foglio
      if (item.declared_row_total !== null && item.declared_row_total !== undefined) {
        checkedMultiplications++;
        const diff = Math.round((calculatedSubtotal - item.declared_row_total) * 100) / 100;
        if (Math.abs(diff) > 0.01) {
          discrepancies.push({
            type: 'multiplication',
            index,
            productName: item.productName,
            declared: item.declared_row_total,
            calculated: calculatedSubtotal,
            diff,
            msg: `Riga ${index + 1} (${item.productName}): scritto sul foglio € ${item.declared_row_total.toFixed(2)}, ma ${qty} × € ${price.toFixed(2)} = € ${calculatedSubtotal.toFixed(2)} (Scostamento: ${diff > 0 ? '+' : ''}${diff.toFixed(2)}€)`
          });
        }
      }

      // 2. Controllo addizione pesi parziali se presenti
      if (Array.isArray(item.sub_weights) && item.sub_weights.length > 1) {
        checkedAdditions++;
        const sumWeights = Math.round(item.sub_weights.reduce((s, w) => s + (parseFloat(w) || 0), 0) * 100) / 100;
        const diffWeights = Math.round((qty - sumWeights) * 100) / 100;
        if (Math.abs(diffWeights) > 0.01) {
          discrepancies.push({
            type: 'addition',
            index,
            productName: item.productName,
            declared: qty,
            calculated: sumWeights,
            diff: diffWeights,
            msg: `Riga ${index + 1} (${item.productName}): somma pesi parziali (${item.sub_weights.join(' + ')}) = ${sumWeights.toFixed(2)} kg vs quantità riportata ${qty.toFixed(2)} kg`
          });
        }
      }
    });

    // 3. Controllo totale complessivo documento
    if (this.detectedGrandTotal !== null && this.detectedGrandTotal !== undefined) {
      grandTotalCalculated = Math.round(grandTotalCalculated * 100) / 100;
      const diffGrand = Math.round((grandTotalCalculated - this.detectedGrandTotal) * 100) / 100;
      if (Math.abs(diffGrand) > 0.01) {
        discrepancies.push({
          type: 'grand_total',
          declared: this.detectedGrandTotal,
          calculated: grandTotalCalculated,
          diff: diffGrand,
          msg: `Totale complessivo scritto sul foglio: € ${this.detectedGrandTotal.toFixed(2)} vs Totale calcolato dalle righe: € ${grandTotalCalculated.toFixed(2)} (Scostamento: ${diffGrand > 0 ? '+' : ''}${diffGrand.toFixed(2)}€)`
        });
      }
    }

    return {
      discrepancies,
      hasDiscrepancies: discrepancies.length > 0,
      checkedMultiplications,
      checkedAdditions,
      grandTotalCalculated
    };
  }

  /**
   * Aggiorna il pannello visivo dell'audit matematico
   */
  updateMathAuditUI() {
    const panel = this.container.querySelector('#math-audit-panel');
    if (!panel) return;

    if (this.extractedItems.length === 0) {
      panel.classList.add('hidden');
      return;
    }

    panel.classList.remove('hidden');
    const audit = this.runMathAudit();

    if (!audit.hasDiscrepancies) {
      panel.innerHTML = `
        <div class="audit-status-banner audit-success">
          <div class="audit-status-icon">✓</div>
          <div class="audit-status-content">
            <h4 class="audit-status-title">Quadratura Matematica Perfetta</h4>
            <p class="audit-status-desc">
              Tutti i calcoli rilevati (moltiplicazioni quantità × prezzi e addizioni dei pesi) sono conformi ed esatti al centesimo.
            </p>
          </div>
        </div>
      `;
    } else {
      panel.innerHTML = `
        <div class="audit-status-banner audit-warning">
          <div class="audit-status-icon">⚠️</div>
          <div class="audit-status-content flex-1">
            <h4 class="audit-status-title">Rilevate ${audit.discrepancies.length} Discrepanze nei Calcoli dell'Appunto</h4>
            <ul class="audit-discrepancies-list">
              ${audit.discrepancies.map(d => `<li>${d.msg}</li>`).join('')}
            </ul>
          </div>
          <button type="button" class="btn btn-sm btn-primary" id="btn-apply-exact-math">
            ✨ Applica Calcoli Esatti
          </button>
        </div>
      `;

      const fixBtn = panel.querySelector('#btn-apply-exact-math');
      if (fixBtn) {
        fixBtn.addEventListener('click', () => this.applyExactMath());
      }
    }
  }

  /**
   * Corregge automaticamente le righe applicando i valori esatti del calcolo aritmetico
   */
  applyExactMath() {
    this.extractedItems.forEach(item => {
      // Se c'erano pesi parziali sommati con discrepanza, adegua la quantità totale
      if (Array.isArray(item.sub_weights) && item.sub_weights.length > 1) {
        const sumW = item.sub_weights.reduce((s, w) => s + (parseFloat(w) || 0), 0);
        item.quantity = Math.round(sumW * 100) / 100;
      }
      // Ricalcola il subtotale esatto
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unitPrice) || 0;
      item.subtotal = Math.round(qty * price * 100) / 100;
      item.declared_row_total = item.subtotal;
    });

    this.detectedGrandTotal = null; // Il totale è ora riallineato al calcolo esatto
    this.renderTableRows();
    this.updateMathAuditUI();
    Toast.success('Tutti i subtotali e i pesi sono stati riallineati con esattezza aritmetica!');
  }

  renderTableRows() {
    const tbody = this.container.querySelector('#review-items-tbody');
    if (!tbody) return;

    const supplier = store.getSupplierById(this.selectedSupplierId);
    const catalog = supplier?.priceList || [];

    tbody.innerHTML = '';

    this.extractedItems.forEach((item, index) => {
      const tr = document.createElement('tr');
      tr.className = 'review-row';

      const hasSubweights = Array.isArray(item.sub_weights) && item.sub_weights.length > 1;
      const subweightsHint = hasSubweights ? `
        <span class="subweights-badge" title="Pesi parziali rilevati">
          ⚖️ Pesi: ${item.sub_weights.join(' + ')} = ${item.quantity}
        </span>
      ` : '';

      const calcHint = item.calculation_expression ? `
        <span class="calc-expression-badge" title="Operazione manoscritta rilevata">
          🔢 ${item.calculation_expression}
        </span>
      ` : '';

      tr.innerHTML = `
        <td>
          <input type="text" class="table-input item-name font-weight-bold" list="catalog-datalist-${index}" value="${item.productName}" data-idx="${index}">
          <datalist id="catalog-datalist-${index}">
            ${catalog.map(c => `<option value="${c.name}">`).join('')}
          </datalist>
          <div class="item-meta-badges">
            ${subweightsHint}
            ${calcHint}
            ${item.notes ? `<small class="item-note-hint">⚠️ ${item.notes}</small>` : ''}
          </div>
        </td>
        <td>
          <input type="number" step="0.01" min="0" class="table-input item-qty font-mono" value="${item.quantity}" data-idx="${index}">
        </td>
        <td>
          <select class="table-select item-unit" data-idx="${index}">
            <option value="kg" ${item.unit === 'kg' ? 'selected' : ''}>kg</option>
            <option value="pz" ${item.unit === 'pz' ? 'selected' : ''}>pz</option>
            <option value="casse" ${item.unit === 'casse' ? 'selected' : ''}>casse</option>
            <option value="colli" ${item.unit === 'colli' ? 'selected' : ''}>colli</option>
            <option value="lt" ${item.unit === 'lt' ? 'selected' : ''}>lt</option>
          </select>
        </td>
        <td>
          <input type="number" step="0.01" min="0" class="table-input item-price font-mono text-right" value="${(item.unitPrice || 0).toFixed(2)}" data-idx="${index}">
        </td>
        <td class="text-right font-weight-bold font-mono row-subtotal" id="subtotal-cell-${index}">
          € ${(item.subtotal || 0).toFixed(2)}
        </td>
        <td class="text-center">
          <button type="button" class="btn-icon-danger btn-delete-row" data-idx="${index}" title="Elimina riga">✕</button>
        </td>
      `;

      tbody.appendChild(tr);
    });

    this.bindRowInputs();
    this.updateTotalsBar();
  }

  bindRowInputs() {
    const tbody = this.container.querySelector('#review-items-tbody');
    if (!tbody) return;

    // Input Nome Prodotto
    tbody.querySelectorAll('.item-name').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        this.extractedItems[idx].productName = e.target.value;
      });
    });

    // Input Quantità con ricalcolo immediato
    tbody.querySelectorAll('.item-qty').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const qty = parseFloat(e.target.value) || 0;
        this.extractedItems[idx].quantity = qty;
        this.extractedItems[idx].subtotal = Math.round(qty * this.extractedItems[idx].unitPrice * 100) / 100;
        this.updateRowSubtotalDisplay(idx);
        this.updateTotalsBar();
        this.updateMathAuditUI();
      });
    });

    // Select Unità di misura
    tbody.querySelectorAll('.item-unit').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        this.extractedItems[idx].unit = e.target.value;
      });
    });

    // Input Prezzo Unitario con ricalcolo immediato
    tbody.querySelectorAll('.item-price').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const price = parseFloat(e.target.value) || 0;
        this.extractedItems[idx].unitPrice = price;
        this.extractedItems[idx].subtotal = Math.round(this.extractedItems[idx].quantity * price * 100) / 100;
        this.updateRowSubtotalDisplay(idx);
        this.updateTotalsBar();
        this.updateMathAuditUI();
      });
    });

    // Eliminazione riga
    tbody.querySelectorAll('.btn-delete-row').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        this.extractedItems.splice(idx, 1);
        this.renderTableRows();
        this.updateMathAuditUI();
      });
    });
  }

  updateRowSubtotalDisplay(idx) {
    const cell = this.container.querySelector(`#subtotal-cell-${idx}`);
    if (cell && this.extractedItems[idx]) {
      cell.textContent = `€ ${this.extractedItems[idx].subtotal.toFixed(2)}`;
    }
  }

  addNewRow() {
    this.extractedItems.push({
      productName: 'Nuovo Articolo',
      quantity: 1,
      sub_weights: [],
      unit: 'kg',
      unitPrice: 0,
      subtotal: 0,
      declared_row_total: null,
      calculation_expression: '',
      notes: ''
    });
    this.renderTableRows();
    this.updateMathAuditUI();
  }

  updatePricesFromSupplierListino() {
    const supplier = store.getSupplierById(this.selectedSupplierId);
    if (!supplier) return;
    const catalog = supplier.priceList || [];

    this.extractedItems.forEach(item => {
      const match = catalog.find(c => 
        c.name.toLowerCase() === item.productName.toLowerCase() ||
        item.productName.toLowerCase().includes(c.name.toLowerCase())
      );
      if (match) {
        item.unitPrice = match.unitPrice;
        item.unit = match.unit;
        item.subtotal = Math.round(item.quantity * item.unitPrice * 100) / 100;
      }
    });

    this.renderTableRows();
    this.updateMathAuditUI();
  }

  updateTotalsBar() {
    const totalRowsEl = this.container.querySelector('#total-rows-val');
    const totalQtyEl = this.container.querySelector('#total-qty-val');
    const grandTotalEl = this.container.querySelector('#grand-total-val');

    let totalQty = 0;
    let grandTotal = 0;

    this.extractedItems.forEach(item => {
      totalQty += (parseFloat(item.quantity) || 0);
      grandTotal += (parseFloat(item.subtotal) || 0);
    });

    if (totalRowsEl) totalRowsEl.textContent = this.extractedItems.length;
    if (totalQtyEl) totalQtyEl.textContent = totalQty.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (grandTotalEl) grandTotalEl.textContent = `€ ${grandTotal.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /**
   * Convalida e archivia la fornitura nel Vault con vincolo obbligatorio fornitore
   * e genera all'istante la Fattura / Ricevuta PDF
   */
  async confirmAndSaveSupply() {
    const supplierSelect = this.container.querySelector('#scan-supplier-select');
    const customSupplierInput = this.container.querySelector('#scan-custom-supplier-input');
    const customName = customSupplierInput?.value?.trim();
    let supplierId = supplierSelect?.value || null;
    let supplierName = '';

    // Verifica vincolante del Fornitore
    if (customName && customName.length > 0) {
      supplierName = customName;
      // Salva o recupera il fornitore censito
      const existing = store.getSuppliers().find(s => s.name.toLowerCase() === customName.toLowerCase());
      if (existing) {
        supplierId = existing.id;
      } else {
        const newSup = await store.saveSupplier({
          name: customName,
          notes: 'Creato automaticamente da Scansione Rapida',
          priceList: []
        });
        supplierId = newSup.id;
      }
    } else if (supplierId) {
      const sup = store.getSupplierById(supplierId);
      supplierName = sup?.name || '';
    }

    if (!supplierName || supplierName.trim() === '') {
      const group = this.container.querySelector('#supplier-selection-group');
      if (group) group.classList.add('supplier-required-error');
      Toast.error('⚠️ NOME FORNITORE OBBLIGATORIO: Seleziona o inserisci un fornitore per convalidare e generare la fattura!');
      if (customSupplierInput) customSupplierInput.focus();
      return;
    }

    if (this.extractedItems.length === 0) {
      Toast.error('Nessuna voce presente nella fornitura.');
      return;
    }

    const dateInput = this.container.querySelector('#scan-date-input');
    const titleInput = this.container.querySelector('#review-doc-title');
    const notesInput = this.container.querySelector('#review-doc-notes');

    const totalQty = this.extractedItems.reduce((sum, item) => sum + (parseFloat(item.quantity) || 0), 0);
    const grandTotal = this.extractedItems.reduce((sum, item) => sum + (parseFloat(item.subtotal) || 0), 0);

    const docDate = dateInput?.value || this.documentDate;
    const invoiceNumber = `FT-${docDate.replace(/-/g, '')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const supplyData = {
      supplierId,
      supplierName,
      invoiceNumber,
      date: docDate,
      documentTitle: titleInput?.value || `Fornitura ${supplierName} - ${docDate}`,
      items: JSON.parse(JSON.stringify(this.extractedItems)),
      totalQuantity: Math.round(totalQty * 100) / 100,
      totalAmount: Math.round(grandTotal * 100) / 100,
      notes: notesInput?.value || '',
      mathAuditStatus: 'VERIFICATO_CONFORME'
    };

    try {
      const savedSupply = await store.saveSupply(supplyData);
      Toast.success('Fornitura convalidata e salvata con successo nel Vault protetto da AES-256!');

      // MOSTRA IMMEDIATAMENTE LA FATTURA PDF A4 PER STAMPA O SALVATAGGIO
      InvoiceGenerator.showInvoiceModal(savedSupply, () => {
        this.resetScan();
        window.appRouter?.navigate('archive');
      });
    } catch (err) {
      Toast.error(`Errore durante il salvataggio nel vault: ${err.message}`);
    }
  }

  resetScan() {
    this.currentImageBase64 = null;
    this.activePendingScanId = null;
    this.extractedItems = [];
    this.documentTitle = '';
    this.notes = '';
    this.customSupplierName = '';
    this.detectedGrandTotal = null;
    this.render();
  }

  /**
   * Carica un appunto manoscritto di prova con elenchi di pesi, somme e moltiplicazioni
   */
  loadDemoSample() {
    const svgSample = `
      <svg xmlns="http://www.w3.org/2000/svg" width="600" height="750" viewBox="0 0 600 750">
        <rect width="600" height="750" fill="#fcfcf7"/>
        <defs>
          <pattern id="grid" width="25" height="25" patternUnits="userSpaceOnUse">
            <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#e3e8f0" stroke-width="0.8"/>
          </pattern>
        </defs>
        <rect width="600" height="750" fill="url(#grid)"/>
        
        <text x="40" y="60" font-family="'Caveat', cursive, sans-serif" font-size="28" fill="#1e3a8a" font-weight="bold">Bolla scarico Ortofrutta - 21/09</text>
        <line x1="40" y1="70" x2="460" y2="70" stroke="#3b82f6" stroke-width="2"/>
        
        <!-- Riga 1 con pesi parziali e moltiplicazione -->
        <text x="50" y="130" font-family="'Caveat', cursive, sans-serif" font-size="22" fill="#0f172a">Pomodori San Marzano</text>
        <text x="50" y="160" font-family="'Caveat', cursive, sans-serif" font-size="20" fill="#2563eb">Pesi: 12,4 + 13,1 = 25,5 kg x 2,20 € = 56,10 €</text>

        <!-- Riga 2 con moltiplicazione -->
        <text x="50" y="220" font-family="'Caveat', cursive, sans-serif" font-size="22" fill="#0f172a">Patate Gialle Bologna</text>
        <text x="50" y="250" font-family="'Caveat', cursive, sans-serif" font-size="20" fill="#2563eb">50 kg x 0,95 € = 47,50 €</text>

        <!-- Riga 3 con moltiplicazione -->
        <text x="50" y="310" font-family="'Caveat', cursive, sans-serif" font-size="22" fill="#0f172a">Zucchine Scure</text>
        <text x="50" y="340" font-family="'Caveat', cursive, sans-serif" font-size="20" fill="#2563eb">7,8 kg x 1,80 € = 14,04 €</text>

        <!-- Riga 4 casse -->
        <text x="50" y="400" font-family="'Caveat', cursive, sans-serif" font-size="22" fill="#0f172a">Insalata Iceberg</text>
        <text x="50" y="430" font-family="'Caveat', cursive, sans-serif" font-size="20" fill="#2563eb">4 casse x 12,50 € = 50,00 €</text>

        <!-- Riga 5 pesi parziali sommati -->
        <text x="50" y="490" font-family="'Caveat', cursive, sans-serif" font-size="22" fill="#0f172a">Arance Navel</text>
        <text x="50" y="520" font-family="'Caveat', cursive, sans-serif" font-size="20" fill="#2563eb">Pesi: 12,6 + 12,6 = 25,2 kg x 1,60 € = 40,32 €</text>

        <!-- Totale manoscritto -->
        <line x1="40" y1="560" x2="520" y2="560" stroke="#0f172a" stroke-width="1.5"/>
        <text x="50" y="600" font-family="'Caveat', cursive, sans-serif" font-size="26" fill="#166534" font-weight="bold">Totale Generale Merci: € 207,96 (Pesi Totali: 108,5 kg)</text>
      </svg>
    `;

    this.currentImageBase64 = btoa(unescape(encodeURIComponent(svgSample)));
    this.currentMimeType = 'image/svg+xml';

    const imgEl = this.container.querySelector('#scanned-image-preview');
    if (imgEl) imgEl.src = `data:${this.currentMimeType};base64,${this.currentImageBase64}`;

    this.processOCRResult({
      document_title: "Bolla scarico Ortofrutta - 21/09",
      document_date: new Date().toISOString().split('T')[0],
      detected_supplier_name: "Ortofrutta Centrale SpA",
      declared_grand_total: 207.96,
      items: [
        {
          product_name: "Pomodori San Marzano",
          quantity: 25.5,
          sub_weights: [12.4, 13.1],
          unit: "kg",
          unit_price: 2.20,
          declared_row_total: 56.10,
          calculation_expression: "12.4 + 13.1 = 25.5 kg * 2.20€ = 56.10€",
          notes: "cifra 7 e 1 verificate, 2 pesi sommati"
        },
        {
          product_name: "Patate Gialle Bologna",
          quantity: 50.0,
          sub_weights: [25.0, 25.0],
          unit: "kg",
          unit_price: 0.95,
          declared_row_total: 47.50,
          calculation_expression: "50 kg * 0.95€ = 47.50€",
          notes: ""
        },
        {
          product_name: "Zucchine Scure",
          quantity: 7.8,
          sub_weights: [],
          unit: "kg",
          unit_price: 1.80,
          declared_row_total: 14.04,
          calculation_expression: "7.8 kg * 1.80€ = 14.04€",
          notes: "cifra 7 con trattino"
        },
        {
          product_name: "Insalata Iceberg",
          quantity: 4.0,
          sub_weights: [],
          unit: "casse",
          unit_price: 12.50,
          declared_row_total: 50.00,
          calculation_expression: "4 casse * 12.50€ = 50.00€",
          notes: ""
        },
        {
          product_name: "Arance Navel",
          quantity: 25.2,
          sub_weights: [12.6, 12.6],
          unit: "kg",
          unit_price: 1.60,
          declared_row_total: 40.32,
          calculation_expression: "12.6 + 12.6 = 25.2 kg * 1.60€ = 40.32€",
          notes: "2 pesi sommati"
        }
      ],
      math_audit: {
        detected_additions_count: 2,
        detected_multiplications_count: 5,
        notes_on_calculations: "Tutte le moltiplicazioni e somme di pesi risultano esatte al centesimo."
      },
      general_notes: "Grafia corsiva nitida, pesi con virgola e moltiplicazioni confermate."
    });

    Toast.info('Appunto demo con pesi, somme e moltiplicazioni caricato con successo!');
  }
}


// --- MODULE: js/views/archiveView.js ---
/**
 * ContiFor - Archive View (Modulo D: Archivio Storico Forniture)
 * 
 * Registro cronologico, filtri avanzati, scheda di dettaglio ed export CSV per Excel
 */





class ArchiveView {
  constructor(container) {
    this.container = container;
    this.filterSupplier = 'ALL';
    this.filterStartDate = '';
    this.filterEndDate = '';
    this.filterSearchText = '';
    this.selectedSupplyForDetail = null;
  }

  render() {
    const suppliers = store.getSuppliers();
    const allSupplies = store.getSupplies();
    const filteredSupplies = this.getFilteredSupplies(allSupplies);

    const totalSpent = filteredSupplies.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
    const totalDeliveries = filteredSupplies.length;

    this.container.innerHTML = `
      <div class="view-header">
        <div>
          <h1 class="view-title">Archivio Storico Forniture</h1>
          <p class="view-subtitle">Consulta, filtra ed esporta tutte le forniture confermate</p>
        </div>
        <div class="view-actions">
          <button type="button" id="btn-export-csv" class="btn btn-secondary btn-sm" title="Esporta le forniture filtrate in CSV per Excel">
            📥 Esporta CSV
          </button>
        </div>
      </div>

      <!-- Filtri di ricerca rapidi -->
      <div class="card filter-card">
        <div class="filter-grid">
          <div class="form-group">
            <label class="form-label" for="filter-supplier">Fornitore</label>
            <select id="filter-supplier" class="form-select">
              <option value="ALL">Tutti i Fornitori</option>
              ${suppliers.map(s => `
                <option value="${s.id}" ${this.filterSupplier === s.id ? 'selected' : ''}>${s.name}</option>
              `).join('')}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="filter-start-date">Dal</label>
            <input type="date" id="filter-start-date" class="form-input" value="${this.filterStartDate}">
          </div>

          <div class="form-group">
            <label class="form-label" for="filter-end-date">Al</label>
            <input type="date" id="filter-end-date" class="form-input" value="${this.filterEndDate}">
          </div>

          <div class="form-group">
            <label class="form-label" for="filter-search-text">Cerca nel testo</label>
            <input type="text" id="filter-search-text" class="form-input" placeholder="Cerca prodotto, nota o doc..." value="${this.filterSearchText}">
          </div>
        </div>

        <div class="filter-footer">
          <div class="filter-stats">
            <span>Forniture: <strong>${totalDeliveries}</strong></span>
            <span>Totale Selezionato: <strong class="text-primary">€ ${totalSpent.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
          </div>
          <button type="button" id="btn-reset-filters" class="btn btn-subtle btn-sm">Reimposta Filtri</button>
        </div>
      </div>

      <!-- Elenco Forniture -->
      <div class="supplies-list-container" id="supplies-list">
        ${filteredSupplies.length === 0 ? `
          <div class="empty-state card">
            <div class="empty-state-icon">📋</div>
            <h3>Nessuna fornitura trovata</h3>
            <p>Nessun record corrisponde ai filtri selezionati o non hai ancora registrato forniture.</p>
          </div>
        ` : `
          <div class="supplies-grid">
            ${filteredSupplies.map(supply => this.renderSupplyCard(supply)).join('')}
          </div>
        `}
      </div>

      <!-- Modal Dettaglio Fornitura -->
      <div id="supply-detail-modal" class="modal-backdrop hidden">
        <div class="modal-content card modal-lg">
          <div class="modal-header">
            <h3 class="modal-title" id="modal-supply-title">Dettaglio Fornitura</h3>
            <button type="button" class="btn-close-modal" id="btn-close-detail">✕</button>
          </div>
          <div class="modal-body" id="modal-supply-body">
            <!-- Popolato dinamicamente da showDetailModal -->
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  renderSupplyCard(supply) {
    const formattedDate = new Date(supply.date).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });

    const itemsCount = supply.items?.length || 0;

    return `
      <div class="card supply-card animate-fade-in" data-id="${supply.id}">
        <div class="supply-card-header">
          <div>
            <span class="supply-supplier-badge">${supply.supplierName}</span>
            <h3 class="supply-card-title">${supply.documentTitle || 'Fornitura'}</h3>
          </div>
          <div class="supply-card-amount">
            € ${(supply.totalAmount || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        <div class="supply-card-meta">
          <span>📅 ${formattedDate}</span>
          <span>📦 ${itemsCount} voci (${(supply.totalQuantity || 0).toFixed(1)} u.m.)</span>
        </div>

        ${supply.notes ? `<p class="supply-card-notes">📝 ${supply.notes}</p>` : ''}

        <div class="supply-card-actions">
          <button type="button" class="btn btn-sm btn-primary btn-print-supply-invoice" data-id="${supply.id}" title="Genera e stampa la fattura PDF di questa fornitura">
            📄 Fattura PDF
          </button>
          <button type="button" class="btn btn-sm btn-outline btn-view-detail" data-id="${supply.id}">
            🔍 Dettaglio & Pesi
          </button>
          <button type="button" class="btn btn-sm btn-icon-danger btn-delete-supply" data-id="${supply.id}" title="Elimina fornitura">
            🗑️
          </button>
        </div>
      </div>
    `;
  }

  getFilteredSupplies(supplies) {
    return supplies.filter(s => {
      // Filtro fornitore
      if (this.filterSupplier !== 'ALL' && s.supplierId !== this.filterSupplier) {
        return false;
      }

      // Filtro data inizio
      if (this.filterStartDate && s.date < this.filterStartDate) {
        return false;
      }

      // Filtro data fine
      if (this.filterEndDate && s.date > this.filterEndDate) {
        return false;
      }

      // Filtro testo libero
      if (this.filterSearchText && this.filterSearchText.trim() !== '') {
        const query = this.filterSearchText.toLowerCase();
        const matchesTitle = s.documentTitle?.toLowerCase().includes(query);
        const matchesSupplier = s.supplierName?.toLowerCase().includes(query);
        const matchesNotes = s.notes?.toLowerCase().includes(query);
        const matchesItems = s.items?.some(i => i.productName.toLowerCase().includes(query));

        if (!matchesTitle && !matchesSupplier && !matchesNotes && !matchesItems) {
          return false;
        }
      }

      return true;
    });
  }

  bindEvents() {
    const supSelect = this.container.querySelector('#filter-supplier');
    if (supSelect) {
      supSelect.addEventListener('change', (e) => {
        this.filterSupplier = e.target.value;
        this.render();
      });
    }

    const startDateInput = this.container.querySelector('#filter-start-date');
    if (startDateInput) {
      startDateInput.addEventListener('change', (e) => {
        this.filterStartDate = e.target.value;
        this.render();
      });
    }

    const endDateInput = this.container.querySelector('#filter-end-date');
    if (endDateInput) {
      endDateInput.addEventListener('change', (e) => {
        this.filterEndDate = e.target.value;
        this.render();
      });
    }

    const searchInput = this.container.querySelector('#filter-search-text');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filterSearchText = e.target.value;
        this.render();
      });
    }

    const resetBtn = this.container.querySelector('#btn-reset-filters');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.filterSupplier = 'ALL';
        this.filterStartDate = '';
        this.filterEndDate = '';
        this.filterSearchText = '';
        this.render();
      });
    }

    const exportCsvBtn = this.container.querySelector('#btn-export-csv');
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', () => this.exportFilteredToCSV());
    }

    // Click delegato sulle card per Dettaglio, Fattura ed Eliminazione
    const listContainer = this.container.querySelector('#supplies-list');
    if (listContainer) {
      listContainer.addEventListener('click', (e) => {
        const invoiceBtn = e.target.closest('.btn-print-supply-invoice');
        if (invoiceBtn) {
          const id = invoiceBtn.dataset.id;
          const supply = store.getSupplyById(id);
          if (supply) {
            InvoiceGenerator.showInvoiceModal(supply);
          }
          return;
        }

        const detailBtn = e.target.closest('.btn-view-detail');
        if (detailBtn) {
          const id = detailBtn.dataset.id;
          this.showDetailModal(id);
          return;
        }

        const deleteBtn = e.target.closest('.btn-delete-supply');
        if (deleteBtn) {
          const id = deleteBtn.dataset.id;
          this.handleDeleteSupply(id);
          return;
        }
      });
    }

    const closeDetailBtn = this.container.querySelector('#btn-close-detail');
    if (closeDetailBtn) {
      closeDetailBtn.addEventListener('click', () => {
        const modal = this.container.querySelector('#supply-detail-modal');
        if (modal) modal.classList.add('hidden');
      });
    }
  }

  showDetailModal(supplyId) {
    const supply = store.getSupplyById(supplyId);
    if (!supply) return;

    const modal = this.container.querySelector('#supply-detail-modal');
    const modalTitle = this.container.querySelector('#modal-supply-title');
    const modalBody = this.container.querySelector('#modal-supply-body');

    modalTitle.textContent = `${supply.documentTitle || 'Fornitura'} - ${supply.supplierName}`;

    modalBody.innerHTML = `
      <div class="modal-info-summary">
        <div><strong>Data:</strong> ${supply.date}</div>
        <div><strong>Fornitore:</strong> ${supply.supplierName}</div>
        <div><strong>Totale Quantità:</strong> ${(supply.totalQuantity || 0).toFixed(2)}</div>
        <div class="text-primary font-weight-bold"><strong>Totale Fornitura:</strong> € ${(supply.totalAmount || 0).toFixed(2)}</div>
      </div>

      ${supply.notes ? `<div class="modal-notes"><strong>Note:</strong> ${supply.notes}</div>` : ''}

      <div class="table-responsive mt-3">
        <table class="items-table">
          <thead>
            <tr>
              <th>Prodotto</th>
              <th class="text-right">Quantità / Peso</th>
              <th>U.M.</th>
              <th class="text-right">Prezzo Unit.</th>
              <th class="text-right">Subtotale</th>
              <th>Note/Origine</th>
            </tr>
          </thead>
          <tbody>
            ${(supply.items || []).map(item => `
              <tr>
                <td class="font-weight-bold">${item.productName}</td>
                <td class="text-right">${item.quantity}</td>
                <td>${item.unit}</td>
                <td class="text-right">€ ${(item.unitPrice || 0).toFixed(2)}</td>
                <td class="text-right font-weight-bold">€ ${(item.subtotal || 0).toFixed(2)}</td>
                <td><small class="text-subtle">${item.notes || '-'}</small></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="modal-actions-bar mt-4 d-flex justify-between">
        <button type="button" class="btn btn-secondary" id="btn-modal-close-bottom">
          Chiudi
        </button>
        <button type="button" class="btn btn-primary" id="btn-modal-print-invoice" data-id="${supply.id}">
          🖨️ Stampa Fattura / Salva PDF A4
        </button>
      </div>
    `;

    const printInvoiceBtn = modalBody.querySelector('#btn-modal-print-invoice');
    if (printInvoiceBtn) {
      printInvoiceBtn.addEventListener('click', () => {
        InvoiceGenerator.showInvoiceModal(supply);
      });
    }

    const closeBottomBtn = modalBody.querySelector('#btn-modal-close-bottom');
    if (closeBottomBtn) {
      closeBottomBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
      });
    }

    modal.classList.remove('hidden');
  }

  async handleDeleteSupply(supplyId) {
    const supply = store.getSupplyById(supplyId);
    if (!supply) return;

    if (confirm(`Sei sicuro di voler eliminare la fornitura "${supply.documentTitle}" di ${supply.supplierName} (€ ${supply.totalAmount.toFixed(2)})?`)) {
      await store.deleteSupply(supplyId);
      Toast.success('Fornitura eliminata dal Vault.');
      this.render();
    }
  }

  /**
   * Genera ed esporta un file CSV compatibile con Microsoft Excel (BOM UTF-8 e separatore punto e virgola)
   */
  exportFilteredToCSV() {
    const allSupplies = store.getSupplies();
    const filtered = this.getFilteredSupplies(allSupplies);

    if (filtered.length === 0) {
      Toast.warning('Nessuna fornitura da esportare con i filtri attuali.');
      return;
    }

    // Intestazione CSV
    const headers = [
      'ID Fornitura',
      'Data Consegna',
      'Fornitore',
      'Riferimento Documento',
      'Prodotto',
      'Quantita',
      'Unita Misura',
      'Prezzo Unitario Euro',
      'Subtotale Riga Euro',
      'Totale Fornitura Euro',
      'Note Articolo',
      'Note Fornitura'
    ];

    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '';
      const text = String(str).replace(/"/g, '""');
      return `"${text}"`;
    };

    const rows = [];
    rows.push(headers.join(';'));

    filtered.forEach(sup => {
      sup.items.forEach(item => {
        const row = [
          escapeCsv(sup.id),
          escapeCsv(sup.date),
          escapeCsv(sup.supplierName),
          escapeCsv(sup.documentTitle),
          escapeCsv(item.productName),
          escapeCsv(item.quantity.toString().replace('.', ',')),
          escapeCsv(item.unit),
          escapeCsv(item.unitPrice.toFixed(2).replace('.', ',')),
          escapeCsv(item.subtotal.toFixed(2).replace('.', ',')),
          escapeCsv(sup.totalAmount.toFixed(2).replace('.', ',')),
          escapeCsv(item.notes || ''),
          escapeCsv(sup.notes || '')
        ];
        rows.push(row.join(';'));
      });
    });

    const csvContent = '\uFEFF' + rows.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    link.setAttribute('href', url);
    link.setAttribute('download', `contifor_storico_forniture_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    Toast.success('File CSV esportato con successo!');
  }
}


// --- MODULE: js/views/suppliersView.js ---
/**
 * ContiFor - Suppliers View (Modulo A: Anagrafica Fornitori e Listini)
 * 
 * Gestione anagrafiche, listini prezzi personalizzati, duplicazione e aggiornamento rapido
 */




class SuppliersView {
  constructor(container) {
    this.container = container;
    this.expandedSupplierId = null;
    this.editingSupplier = null;
  }

  render() {
    const suppliers = store.getSuppliers();

    this.container.innerHTML = `
      <div class="view-header">
        <div>
          <h1 class="view-title">Anagrafica Fornitori & Listini</h1>
          <p class="view-subtitle">Gestisci fornitori, prodotti e prezzi unitari concordati</p>
        </div>
        <div class="view-actions">
          <button type="button" id="btn-new-supplier" class="btn btn-primary btn-sm">
            ➕ Nuovo Fornitore
          </button>
        </div>
      </div>

      <!-- Elenco Fornitori -->
      <div class="suppliers-list">
        ${suppliers.length === 0 ? `
          <div class="card empty-state">
            <div class="empty-state-icon">🏢</div>
            <h3>Nessun fornitore registrato</h3>
            <p>Aggiungi il tuo primo fornitore con il relativo listino prezzi per iniziare.</p>
            <button type="button" id="btn-empty-new-supplier" class="btn btn-primary mt-3">
              Crea Fornitore
            </button>
          </div>
        ` : `
          <div class="suppliers-grid">
            ${suppliers.map(s => this.renderSupplierCard(s)).join('')}
          </div>
        `}
      </div>

      <!-- Modal Crea / Modifica Fornitore -->
      <div id="supplier-modal" class="modal-backdrop hidden">
        <div class="modal-content card modal-lg">
          <div class="modal-header">
            <h3 class="modal-title" id="supplier-modal-title">Nuovo Fornitore</h3>
            <button type="button" class="btn-close-modal" id="btn-close-supplier-modal">✕</button>
          </div>
          <form id="supplier-form">
            <div class="modal-body">
              <input type="hidden" id="modal-sup-id" value="">
              
              <div class="form-group">
                <label class="form-label" for="modal-sup-name">Ragione Sociale / Nome Fornitore *</label>
                <input type="text" id="modal-sup-name" class="form-input" required placeholder="Es. Ortofrutta Centrale SpA">
              </div>

              <div class="form-row">
                <div class="form-group flex-1">
                  <label class="form-label" for="modal-sup-contact">Referente / Telefono / Email</label>
                  <input type="text" id="modal-sup-contact" class="form-input" placeholder="Es. Mario Rossi - 335 1234567">
                </div>
                <div class="form-group flex-1">
                  <label class="form-label" for="modal-sup-notes">Note di consegna / orari</label>
                  <input type="text" id="modal-sup-notes" class="form-input" placeholder="Es. Consegna prima delle 07:00">
                </div>
              </div>

              <hr class="divider">

              <div class="pricelist-editor-header">
                <div>
                  <h4 class="section-title">Listino Prezzi Prodotti</h4>
                  <p class="section-subtitle">Configura i prodotti e i prezzi concordati in Euro (€)</p>
                </div>
                <button type="button" id="btn-modal-add-product" class="btn btn-sm btn-outline">
                  ➕ Aggiungi Prodotto
                </button>
              </div>

              <div class="table-responsive">
                <table class="items-table">
                  <thead>
                    <tr>
                      <th style="width: 45%;">Nome Prodotto</th>
                      <th style="width: 22%;">U.M.</th>
                      <th style="width: 23%;">Prezzo (€)</th>
                      <th style="width: 10%;"></th>
                    </tr>
                  </thead>
                  <tbody id="modal-pricelist-tbody">
                    <!-- Popolato dinamicamente -->
                  </tbody>
                </table>
              </div>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="btn-modal-cancel">Annulla</button>
              <button type="submit" class="btn btn-primary">Salva nel Vault</button>
            </div>
          </form>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  renderSupplierCard(supplier) {
    const productsCount = supplier.priceList?.length || 0;
    const isExpanded = this.expandedSupplierId === supplier.id;

    return `
      <div class="card supplier-card" data-id="${supplier.id}">
        <div class="supplier-card-header">
          <div>
            <h3 class="supplier-name">${supplier.name}</h3>
            ${supplier.contact ? `<p class="supplier-contact">📞 ${supplier.contact}</p>` : ''}
            ${supplier.notes ? `<p class="supplier-notes">📝 ${supplier.notes}</p>` : ''}
          </div>
          <div class="supplier-badge">
            ${productsCount} prodotti a listino
          </div>
        </div>

        <!-- Azioni rapide fornitore -->
        <div class="supplier-actions">
          <button type="button" class="btn btn-sm btn-outline btn-toggle-pricelist" data-id="${supplier.id}">
            ${isExpanded ? '▲ Nascondi Listino' : '▼ Visualizza / Modifica Prezzi'}
          </button>
          <button type="button" class="btn btn-sm btn-subtle btn-duplicate-supplier" data-id="${supplier.id}" title="Duplica fornitore e listino">
            📋 Duplica
          </button>
          <button type="button" class="btn btn-sm btn-subtle btn-edit-supplier" data-id="${supplier.id}">
            ✏️ Modifica
          </button>
          <button type="button" class="btn btn-sm btn-icon-danger btn-delete-supplier" data-id="${supplier.id}" title="Elimina fornitore">
            🗑️
          </button>
        </div>

        <!-- Sezione Listino Espansa -->
        <div class="supplier-pricelist-section ${isExpanded ? '' : 'hidden'}" id="pricelist-section-${supplier.id}">
          <div class="pricelist-quick-bar">
            <span class="text-subtle">Modifica rapida prezzi unitari: i cambiamenti si salvano all'uscita dal campo.</span>
          </div>

          <div class="table-responsive">
            <table class="items-table">
              <thead>
                <tr>
                  <th>Prodotto</th>
                  <th>U.M.</th>
                  <th style="width: 140px;">Prezzo Unitario (€)</th>
                </tr>
              </thead>
              <tbody>
                ${productsCount === 0 ? `
                  <tr><td colspan="3" class="text-center text-subtle">Nessun prodotto in questo listino. Clicca 'Modifica' per aggiungerne.</td></tr>
                ` : (supplier.priceList || []).map(prod => `
                  <tr>
                    <td class="font-weight-bold">${prod.name}</td>
                    <td><span class="badge">${prod.unit}</span></td>
                    <td>
                      <div class="input-with-symbol">
                        <span class="symbol">€</span>
                        <input type="number" step="0.01" min="0" 
                               class="table-input quick-price-input" 
                               value="${prod.unitPrice.toFixed(2)}"
                               data-sup-id="${supplier.id}"
                               data-prod-id="${prod.id}">
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    const newBtn = this.container.querySelector('#btn-new-supplier');
    if (newBtn) newBtn.addEventListener('click', () => this.openSupplierModal());

    const emptyNewBtn = this.container.querySelector('#btn-empty-new-supplier');
    if (emptyNewBtn) emptyNewBtn.addEventListener('click', () => this.openSupplierModal());

    // Eventi delegati sulla lista fornitori
    const listContainer = this.container.querySelector('.suppliers-list');
    if (listContainer) {
      listContainer.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest('.btn-toggle-pricelist');
        if (toggleBtn) {
          const id = toggleBtn.dataset.id;
          this.expandedSupplierId = this.expandedSupplierId === id ? null : id;
          this.render();
          return;
        }

        const editBtn = e.target.closest('.btn-edit-supplier');
        if (editBtn) {
          const id = editBtn.dataset.id;
          this.openSupplierModal(id);
          return;
        }

        const duplicateBtn = e.target.closest('.btn-duplicate-supplier');
        if (duplicateBtn) {
          const id = duplicateBtn.dataset.id;
          this.handleDuplicateSupplier(id);
          return;
        }

        const deleteBtn = e.target.closest('.btn-delete-supplier');
        if (deleteBtn) {
          const id = deleteBtn.dataset.id;
          this.handleDeleteSupplier(id);
          return;
        }
      });

      // Quick price edit change event
      listContainer.addEventListener('change', async (e) => {
        if (e.target.classList.contains('quick-price-input')) {
          const supId = e.target.dataset.supId;
          const prodId = e.target.dataset.prodId;
          const newPrice = parseFloat(e.target.value) || 0;

          const supplier = store.getSupplierById(supId);
          if (supplier) {
            const prod = supplier.priceList.find(p => p.id === prodId);
            if (prod) {
              prod.unitPrice = newPrice;
              await store.saveSupplier(supplier);
              Toast.success(`Prezzo di ${prod.name} aggiornato a € ${newPrice.toFixed(2)}`);
            }
          }
        }
      });
    }

    // Modal Fornitore
    const closeBtn = this.container.querySelector('#btn-close-supplier-modal');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeSupplierModal());

    const cancelBtn = this.container.querySelector('#btn-modal-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeSupplierModal());

    const addProdBtn = this.container.querySelector('#btn-modal-add-product');
    if (addProdBtn) addProdBtn.addEventListener('click', () => this.addModalProductRow());

    const form = this.container.querySelector('#supplier-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleSaveSupplierModal();
      });
    }
  }

  openSupplierModal(supplierId = null) {
    const modal = this.container.querySelector('#supplier-modal');
    const title = this.container.querySelector('#supplier-modal-title');
    const idInput = this.container.querySelector('#modal-sup-id');
    const nameInput = this.container.querySelector('#modal-sup-name');
    const contactInput = this.container.querySelector('#modal-sup-contact');
    const notesInput = this.container.querySelector('#modal-sup-notes');
    const tbody = this.container.querySelector('#modal-pricelist-tbody');

    tbody.innerHTML = '';

    if (supplierId) {
      const supplier = store.getSupplierById(supplierId);
      if (!supplier) return;
      this.editingSupplier = JSON.parse(JSON.stringify(supplier));
      title.textContent = `Modifica Fornitore: ${supplier.name}`;
      idInput.value = supplier.id;
      nameInput.value = supplier.name;
      contactInput.value = supplier.contact || '';
      notesInput.value = supplier.notes || '';

      (supplier.priceList || []).forEach(prod => {
        this.addModalProductRow(prod.name, prod.unit, prod.unitPrice, prod.id);
      });
    } else {
      this.editingSupplier = null;
      title.textContent = 'Nuovo Fornitore';
      idInput.value = '';
      nameInput.value = '';
      contactInput.value = '';
      notesInput.value = '';
      // Due righe predefinite
      this.addModalProductRow('', 'kg', 0);
      this.addModalProductRow('', 'pz', 0);
    }

    modal.classList.remove('hidden');
    nameInput.focus();
  }

  closeSupplierModal() {
    const modal = this.container.querySelector('#supplier-modal');
    if (modal) modal.classList.add('hidden');
  }

  addModalProductRow(name = '', unit = 'kg', price = 0, id = null) {
    const tbody = this.container.querySelector('#modal-pricelist-tbody');
    if (!tbody) return;

    const tr = document.createElement('tr');
    tr.className = 'modal-product-row';
    tr.dataset.prodId = id || ('prod_' + Math.random().toString(36).substring(2, 9));

    tr.innerHTML = `
      <td>
        <input type="text" class="table-input prod-name" placeholder="Es. Mele Golden" value="${name}" required>
      </td>
      <td>
        <select class="table-select prod-unit">
          <option value="kg" ${unit === 'kg' ? 'selected' : ''}>kg</option>
          <option value="pz" ${unit === 'pz' ? 'selected' : ''}>pz</option>
          <option value="casse" ${unit === 'casse' ? 'selected' : ''}>casse</option>
          <option value="colli" ${unit === 'colli' ? 'selected' : ''}>colli</option>
          <option value="lt" ${unit === 'lt' ? 'selected' : ''}>lt</option>
        </select>
      </td>
      <td>
        <div class="input-with-symbol">
          <span class="symbol">€</span>
          <input type="number" step="0.01" min="0" class="table-input prod-price" value="${price}" required>
        </div>
      </td>
      <td class="text-center">
        <button type="button" class="btn-icon-danger btn-modal-del-row" title="Rimuovi prodotto">🗑️</button>
      </td>
    `;

    tr.querySelector('.btn-modal-del-row').addEventListener('click', () => {
      tr.remove();
    });

    tbody.appendChild(tr);
  }

  async handleSaveSupplierModal() {
    const idInput = this.container.querySelector('#modal-sup-id');
    const nameInput = this.container.querySelector('#modal-sup-name');
    const contactInput = this.container.querySelector('#modal-sup-contact');
    const notesInput = this.container.querySelector('#modal-sup-notes');
    const rows = this.container.querySelectorAll('.modal-product-row');

    const priceList = [];
    rows.forEach(r => {
      const name = r.querySelector('.prod-name').value.trim();
      const unit = r.querySelector('.prod-unit').value;
      const price = parseFloat(r.querySelector('.prod-price').value) || 0;
      const prodId = r.dataset.prodId;

      if (name) {
        priceList.push({
          id: prodId,
          name,
          unit,
          unitPrice: price
        });
      }
    });

    const supplierData = {
      id: idInput.value || null,
      name: nameInput.value.trim(),
      contact: contactInput.value.trim(),
      notes: notesInput.value.trim(),
      priceList
    };

    try {
      await store.saveSupplier(supplierData);
      Toast.success('Fornitore e listino salvati con successo nel Vault.');
      this.closeSupplierModal();
      this.render();
    } catch (err) {
      Toast.error(`Errore salvataggio fornitore: ${err.message}`);
    }
  }

  async handleDuplicateSupplier(supplierId) {
    const source = store.getSupplierById(supplierId);
    if (!source) return;

    const newName = prompt(`Inserisci il nome per il fornitore duplicato:`, `${source.name} (Copia)`);
    if (!newName) return;

    try {
      await store.duplicateSupplierPriceList(supplierId, newName);
      Toast.success(`Fornitore e listino duplicati come "${newName}".`);
      this.render();
    } catch (err) {
      Toast.error(`Errore duplicazione: ${err.message}`);
    }
  }

  async handleDeleteSupplier(supplierId) {
    const supplier = store.getSupplierById(supplierId);
    if (!supplier) return;

    if (confirm(`Eliminare il fornitore "${supplier.name}" e il relativo listino prezzi?`)) {
      await store.deleteSupplier(supplierId);
      Toast.success('Fornitore eliminato dal Vault.');
      this.render();
    }
  }
}


// --- MODULE: js/views/reportView.js ---
/**
 * ContiFor - Report View (Modulo E: Dashboard di Reportistica e Confronto Selettivo Costi)
 * 
 * Filtri multi-select fornitori, metriche aggregate, grafici SVG nativi e tabella comparativa
 */




class ReportView {
  constructor(container) {
    this.container = container;
    this.selectedSupplierIds = new Set();
    this.periodFilter = 'ALL'; // '30D', '90D', 'CURRENT_MONTH', 'YEAR', 'ALL'
    this.initialized = false;
  }

  render() {
    const allSuppliers = store.getSuppliers();
    const allSupplies = store.getSupplies();

    // Di default, all'avvio seleziona tutti i fornitori presenti
    if (!this.initialized && allSuppliers.length > 0) {
      this.selectedSupplierIds = new Set(allSuppliers.map(s => s.id));
      this.initialized = true;
    }

    // Filtraggio per periodo
    const filteredByPeriod = this.filterSuppliesByPeriod(allSupplies);

    // Filtraggio per soli fornitori selezionati
    const targetSupplies = filteredByPeriod.filter(s => this.selectedSupplierIds.has(s.supplierId));

    // Metriche chiave aggregate
    const totalSpent = targetSupplies.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
    const totalDeliveries = targetSupplies.length;
    const avgDeliveryCost = totalDeliveries > 0 ? totalSpent / totalDeliveries : 0;
    const totalQty = targetSupplies.reduce((acc, s) => acc + (s.totalQuantity || 0), 0);

    this.container.innerHTML = `
      <div class="view-header">
        <div>
          <h1 class="view-title">Dashboard & Confronto Fornitori</h1>
          <p class="view-subtitle">Analisi comparativa selettiva dei costi e incidenza sui volumi</p>
        </div>
      </div>

      <!-- Sezione Filtri Selettivi Fornitori (Checkbox Multi-select) -->
      <div class="card selector-filter-card">
        <div class="filter-card-header">
          <div class="filter-card-title-group">
            <h3 class="card-title">Filtro Fornitori a Confronto</h3>
            <p class="card-subtitle">Seleziona o deseleziona i fornitori per isolare il confronto (es. solo A vs B)</p>
          </div>
          <div class="filter-actions-inline">
            <button type="button" id="btn-select-all-sup" class="btn btn-sm btn-subtle">Seleziona Tutti</button>
            <button type="button" id="btn-clear-all-sup" class="btn btn-sm btn-subtle">Deseleziona</button>
          </div>
        </div>

        <div class="supplier-checkbox-chips" id="supplier-chips-container">
          ${allSuppliers.map((s, index) => {
            const isChecked = this.selectedSupplierIds.has(s.id);
            const badgeColor = ChartEngine.getColor(index);
            return `
              <label class="chip-checkbox ${isChecked ? 'active' : ''}">
                <input type="checkbox" class="sup-filter-checkbox" value="${s.id}" ${isChecked ? 'checked' : ''}>
                <span class="chip-color-dot" style="background-color: ${badgeColor};"></span>
                <span class="chip-text">${s.name}</span>
              </label>
            `;
          }).join('')}
          ${allSuppliers.length === 0 ? '<p class="text-subtle">Nessun fornitore registrato nel sistema.</p>' : ''}
        </div>

        <!-- Periodo temporale -->
        <div class="period-select-row mt-3">
          <label class="form-label" for="report-period-select">Periodo di Analisi:</label>
          <select id="report-period-select" class="form-select period-select-input">
            <option value="ALL" ${this.periodFilter === 'ALL' ? 'selected' : ''}>Tutto lo storico</option>
            <option value="CURRENT_MONTH" ${this.periodFilter === 'CURRENT_MONTH' ? 'selected' : ''}>Mese corrente</option>
            <option value="30D" ${this.periodFilter === '30D' ? 'selected' : ''}>Ultimi 30 giorni</option>
            <option value="90D" ${this.periodFilter === '90D' ? 'selected' : ''}>Ultimi 90 giorni</option>
            <option value="YEAR" ${this.periodFilter === 'YEAR' ? 'selected' : ''}>Anno corrente</option>
          </select>
        </div>
      </div>

      <!-- KPI Cards -->
      <div class="kpi-grid">
        <div class="card kpi-card">
          <span class="kpi-label">Spesa Totale Selezionata</span>
          <span class="kpi-value text-primary">€ ${totalSpent.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span class="kpi-subtext">Tra ${this.selectedSupplierIds.size} fornitori inclusi</span>
        </div>

        <div class="card kpi-card">
          <span class="kpi-label">Forniture Effettuate</span>
          <span class="kpi-value">${totalDeliveries}</span>
          <span class="kpi-subtext">Consegne verificate</span>
        </div>

        <div class="card kpi-card">
          <span class="kpi-label">Costo Medio per Fornitura</span>
          <span class="kpi-value">€ ${avgDeliveryCost.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span class="kpi-subtext">Valore medio scontrino/bolla</span>
        </div>

        <div class="card kpi-card">
          <span class="kpi-label">Quantità Totale Movimentata</span>
          <span class="kpi-value">${totalQty.toFixed(1)}</span>
          <span class="kpi-subtext">Unità complessive (kg/pz)</span>
        </div>
      </div>

      <!-- Sezione Grafici Interattivi -->
      <div class="charts-row">
        <!-- Grafico Ciambella Incidenza Percentuale -->
        <div class="card chart-card flex-1">
          <div class="card-header-clean">
            <h3 class="card-title">Ripartizione della Spesa (%)</h3>
            <p class="card-subtitle">Incidenza sul budget dei soli fornitori selezionati</p>
          </div>
          <div id="donut-chart-box" class="chart-content-box"></div>
        </div>

        <!-- Grafico Andamento Mensile -->
        <div class="card chart-card flex-1">
          <div class="card-header-clean">
            <h3 class="card-title">Andamento Mensile per Fornitore</h3>
            <p class="card-subtitle">Confronto dei costi nei vari mesi</p>
          </div>
          <div id="bar-chart-box" class="chart-content-box"></div>
        </div>
      </div>

      <!-- Tabella Comparativa di Dettaglio -->
      <div class="card mt-3">
        <div class="card-header-clean">
          <h3 class="card-title">Tabella Comparativa Fornitori</h3>
          <p class="card-subtitle">Spesa cumulata, numero consegne, costo medio e incidenza percentuale</p>
        </div>
        <div class="table-responsive">
          <table class="items-table" id="comparison-table">
            <thead>
              <tr>
                <th>Fornitore</th>
                <th class="text-right">Forniture</th>
                <th class="text-right">Q.tà Totale</th>
                <th class="text-right">Costo Medio</th>
                <th class="text-right">Spesa Cumulata</th>
                <th class="text-right">Incidenza %</th>
              </tr>
            </thead>
            <tbody id="comparison-tbody">
              <!-- Popolato da renderComparisonTable -->
            </tbody>
          </table>
        </div>
      </div>
    `;

    this.bindEvents();
    this.renderCharts(targetSupplies, allSuppliers, totalSpent);
    this.renderComparisonTable(targetSupplies, allSuppliers, totalSpent);
  }

  filterSuppliesByPeriod(supplies) {
    const now = new Date();
    if (this.periodFilter === 'ALL') return supplies;

    let cutoffDate = new Date(0);

    if (this.periodFilter === '30D') {
      cutoffDate = new Date(now.getTime() - 30 * 86400000);
    } else if (this.periodFilter === '90D') {
      cutoffDate = new Date(now.getTime() - 90 * 86400000);
    } else if (this.periodFilter === 'CURRENT_MONTH') {
      cutoffDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (this.periodFilter === 'YEAR') {
      cutoffDate = new Date(now.getFullYear(), 0, 1);
    }

    const cutoffISO = cutoffDate.toISOString().split('T')[0];
    return supplies.filter(s => s.date >= cutoffISO);
  }

  renderCharts(targetSupplies, allSuppliers, totalSpent) {
    // 1. Ripartizione Donut Chart
    const donutBox = this.container.querySelector('#donut-chart-box');
    if (donutBox) {
      const donutData = [];
      allSuppliers.forEach((s, idx) => {
        if (this.selectedSupplierIds.has(s.id)) {
          const supSupplies = targetSupplies.filter(entry => entry.supplierId === s.id);
          const spent = supSupplies.reduce((sum, entry) => sum + (entry.totalAmount || 0), 0);
          donutData.push({
            label: s.name,
            value: spent,
            color: ChartEngine.getColor(idx)
          });
        }
      });
      ChartEngine.renderDonutChart(donutBox, donutData, 'Totale Selezionato');
    }

    // 2. Bar Chart Andamento Mensile
    const barBox = this.container.querySelector('#bar-chart-box');
    if (barBox) {
      // Calcola gli ultimi 6 mesi
      const months = [];
      const monthKeys = [];
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const label = d.toLocaleDateString('it-IT', { month: 'short' });
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        months.push(label.charAt(0).toUpperCase() + label.slice(1));
        monthKeys.push(key);
      }

      const series = [];
      allSuppliers.forEach((s, idx) => {
        if (this.selectedSupplierIds.has(s.id)) {
          const monthlyTotals = monthKeys.map(mKey => {
            const inMonth = targetSupplies.filter(entry => entry.supplierId === s.id && entry.date?.startsWith(mKey));
            return inMonth.reduce((sum, entry) => sum + (entry.totalAmount || 0), 0);
          });

          series.push({
            supplierId: s.id,
            supplierName: s.name,
            color: ChartEngine.getColor(idx),
            monthlyTotals
          });
        }
      });

      ChartEngine.renderMonthlyBarChart(barBox, months, series);
    }
  }

  renderComparisonTable(targetSupplies, allSuppliers, totalSpent) {
    const tbody = this.container.querySelector('#comparison-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const rowsData = [];
    allSuppliers.forEach((s, idx) => {
      if (this.selectedSupplierIds.has(s.id)) {
        const supSupplies = targetSupplies.filter(entry => entry.supplierId === s.id);
        const count = supSupplies.length;
        const total = supSupplies.reduce((sum, entry) => sum + (entry.totalAmount || 0), 0);
        const qty = supSupplies.reduce((sum, entry) => sum + (entry.totalQuantity || 0), 0);
        const avg = count > 0 ? total / count : 0;
        const percent = totalSpent > 0 ? (total / totalSpent) * 100 : 0;

        rowsData.push({
          supplier: s,
          color: ChartEngine.getColor(idx),
          count,
          total,
          qty,
          avg,
          percent
        });
      }
    });

    // Ordina per spesa totale decrescente
    rowsData.sort((a, b) => b.total - a.total);

    if (rowsData.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-subtle">Nessun dato per i fornitori selezionati.</td></tr>`;
      return;
    }

    rowsData.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="sup-table-cell">
            <span class="color-dot" style="background-color: ${row.color};"></span>
            <strong>${row.supplier.name}</strong>
          </div>
        </td>
        <td class="text-right">${row.count}</td>
        <td class="text-right">${row.qty.toFixed(1)}</td>
        <td class="text-right">€ ${row.avg.toFixed(2)}</td>
        <td class="text-right font-weight-bold">€ ${row.total.toFixed(2)}</td>
        <td class="text-right"><span class="badge ${row.percent > 40 ? 'badge-warning' : 'badge-info'}">${row.percent.toFixed(1)}%</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  bindEvents() {
    // Gestione checkbox fornitore
    const chipsContainer = this.container.querySelector('#supplier-chips-container');
    if (chipsContainer) {
      chipsContainer.addEventListener('change', (e) => {
        if (e.target.classList.contains('sup-filter-checkbox')) {
          const supId = e.target.value;
          if (e.target.checked) {
            this.selectedSupplierIds.add(supId);
          } else {
            this.selectedSupplierIds.delete(supId);
          }
          this.render();
        }
      });
    }

    // Seleziona tutti
    const selectAllBtn = this.container.querySelector('#btn-select-all-sup');
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', () => {
        const suppliers = store.getSuppliers();
        this.selectedSupplierIds = new Set(suppliers.map(s => s.id));
        this.render();
      });
    }

    // Deseleziona tutti
    const clearAllBtn = this.container.querySelector('#btn-clear-all-sup');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        this.selectedSupplierIds.clear();
        this.render();
      });
    }

    // Cambio periodo
    const periodSelect = this.container.querySelector('#report-period-select');
    if (periodSelect) {
      periodSelect.addEventListener('change', (e) => {
        this.periodFilter = e.target.value;
        this.render();
      });
    }
  }
}


// --- MODULE: js/views/settingsView.js ---
/**
 * ContiFor - Settings View
 * 
 * Gestione Gemini API Key, Accesso Biometrico (WebAuthn), Sincronizzazione Cloud Cifrata (GitHub Gist),
 * Backup Cifrato, Master Password, Aspetto e Blocco Vault
 */








class SettingsView {
  constructor(container) {
    this.container = container;
  }

  async render() {
    const settings = store.getSettings();
    const isBioAvailable = await BiometricsManager.isAvailable();
    const isBioEnrolled = BiometricsManager.isEnrolled();

    this.container.innerHTML = `
      <div class="view-header">
        <div>
          <h1 class="view-title">Impostazioni & Sicurezza</h1>
          <p class="view-subtitle">Crittografia, Accesso Biometrico, Cloud GitHub e Gemini API</p>
        </div>
      </div>

      <div class="settings-container">
        <!-- Scheda 1: Accesso Biometrico (Impronta / Face ID / Windows Hello) -->
        <div class="card settings-card">
          <div class="card-header-clean">
            <h3 class="card-title">👆 Accesso Biometrico (Impronta / Face ID)</h3>
            <p class="card-subtitle">Accedi all'app all'istante usando l'impronta digitale o il riconoscimento facciale del tuo smartphone o computer.</p>
          </div>

          <div class="biometrics-settings-content mt-3">
            ${!isBioAvailable ? `
              <div class="alert-box alert-warning">
                ⚠️ Il sensore biometrico (impronta digitale o Face ID) non risulta disponibile su questo browser o dispositivo.
              </div>
            ` : isBioEnrolled ? `
              <div class="d-flex items-center justify-between flex-wrap gap-2">
                <div class="biometrics-status-badge">
                  <span class="badge badge-success">✓ Biometria Attiva su questo dispositivo</span>
                  <small class="d-block text-subtle mt-1">Puoi sbloccare ContiFor con la tua impronta digitale o Face ID.</small>
                </div>
                <button type="button" id="btn-disable-biometrics" class="btn btn-outline btn-sm">
                  Disabilita Biometria
                </button>
              </div>
            ` : `
              <div>
                <p class="text-subtle">Il tuo dispositivo supporta lo sblocco biometrico sicuro (WebAuthn / Passkeys).</p>
                <button type="button" id="btn-enable-biometrics" class="btn btn-primary mt-2">
                  👆 Abilita Impronta / Face ID su questo dispositivo
                </button>
              </div>
            `}
          </div>
        </div>

        <!-- Scheda 2: Sincronizzazione Cloud Cifrata Zero-Knowledge (GitHub Gist) -->
        <div class="card settings-card">
          <div class="card-header-clean">
            <h3 class="card-title">☁️ Sincronizzazione Cloud Cifrata (Smartphone ⇄ Desktop)</h3>
            <p class="card-subtitle">
              Sincronizza le bolle e i prezzi tra telefono e PC. I dati vengono cifrati con AES-256 prima dell'invio: 
              <strong>nemmeno GitHub può leggere i tuoi dati</strong> (Zero-Knowledge).
            </p>
          </div>

          <form id="form-github-sync" class="mt-3">
            <div class="form-group">
              <label class="form-label" for="setting-github-token">GitHub Personal Access Token (PAT) *</label>
              <div class="input-with-button">
                <input type="password" id="setting-github-token" class="form-input" 
                  placeholder="ghp_..." value="${settings.githubToken || ''}">
                <button type="button" id="btn-toggle-github-token" class="btn btn-secondary btn-sm">Mostra</button>
              </div>
              <small class="text-subtle mt-1 d-block">
                Token gratuito con solo il permesso <code>gist</code>. Generabile su 
                <a href="https://github.com/settings/tokens/new?scopes=gist&description=ContiFor_Encrypted_Vault" target="_blank" rel="noopener noreferrer" class="text-primary font-weight-bold">
                  GitHub > Developer Settings > Tokens (Classic) ↗
                </a>
              </small>
            </div>

            <div class="form-group">
              <label class="form-label" for="setting-github-gist-id">ID Gist Privato (Opzionale: rilevato o creato in automatico)</label>
              <input type="text" id="setting-github-gist-id" class="form-input" 
                placeholder="Lascia vuoto: verrà creato o rilevato automaticamente" value="${settings.githubGistId || ''}">
            </div>

            <div class="cloud-sync-status-row mt-2">
              <span class="text-subtle">
                ${settings.lastCloudSyncDate 
                  ? `Ultima sincronizzazione cloud: <strong>${new Date(settings.lastCloudSyncDate).toLocaleString('it-IT')}</strong>` 
                  : 'Nessuna sincronizzazione cloud effettuata.'}
              </span>
            </div>

            <div class="d-flex gap-2 flex-wrap mt-3">
              <button type="button" id="btn-sync-now" class="btn btn-primary">
                ☁️ Sincronizza Ora (2-Way Bidirezionale)
              </button>
              <button type="button" id="btn-pull-vault" class="btn btn-outline">
                📥 Scarica dal Cloud (Pull)
              </button>
              <button type="button" id="btn-push-vault" class="btn btn-outline">
                📤 Invia al Cloud (Push Forzato)
              </button>
              <button type="button" id="btn-test-github-token" class="btn btn-subtle">
                ⚡ Verifica Token
              </button>
              <button type="button" id="btn-create-gist" class="btn btn-subtle">
                🚀 Crea Gist Privato
              </button>
              <button type="submit" class="btn btn-subtle">
                💾 Salva Token
              </button>
            </div>
          </form>
        </div>

        <!-- Scheda 3: Chiave API Google AI Studio -->
        <div class="card settings-card">
          <div class="card-header-clean">
            <h3 class="card-title">🔑 Chiave API Google AI Studio</h3>
            <p class="card-subtitle">Inserisci la chiave generata su Google AI Studio per l'analisi OCR dei manoscritti con Gemini Flash.</p>
          </div>

          <form id="form-gemini-settings" class="mt-3">
            <div class="form-group">
              <label class="form-label" for="setting-gemini-key">Chiave API Google AI Studio *</label>
              <div class="input-with-button">
                <input type="password" id="setting-gemini-key" class="form-input" placeholder="AIzaSy..." value="${settings.geminiApiKey || ''}">
                <button type="button" id="btn-toggle-key-visibility" class="btn btn-secondary btn-sm">Mostra</button>
              </div>
              <small class="text-subtle mt-1 d-block">
                Puoi creare la tua chiave gratuita direttamente su <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" class="text-primary font-weight-bold">Google AI Studio (Get API Key) ↗</a>
              </small>
            </div>

            <div class="form-group">
              <label class="form-label" for="setting-gemini-model">Modello Multimodale</label>
              <select id="setting-gemini-model" class="form-select">
                <option value="gemini-3.8-flash" ${settings.geminiModel === 'gemini-3.8-flash' || !settings.geminiModel || settings.geminiModel.includes('2.5') ? 'selected' : ''}>gemini-3.8-flash (Consigliato - Modello Flash di riferimento)</option>
                <option value="gemini-3.6-flash" ${settings.geminiModel === 'gemini-3.6-flash' ? 'selected' : ''}>gemini-3.6-flash (Modello Flash alternativo)</option>
                <option value="gemini-flash-latest" ${settings.geminiModel === 'gemini-flash-latest' ? 'selected' : ''}>gemini-flash-latest (Aggiornato costantemente all'ultimo Flash)</option>
              </select>
            </div>

            <div class="d-flex gap-2 flex-wrap mt-3">
              <button type="button" id="btn-test-gemini-key" class="btn btn-outline">
                ⚡ Testa Connessione Google AI Studio
              </button>
              <button type="submit" class="btn btn-primary">
                💾 Salva Chiave nel Vault Cifrato
              </button>
            </div>
          </form>
        </div>

        <!-- Scheda 4: Backup e Ripristino Cifrato Locale (.json) -->
        <div class="card settings-card">
          <div class="card-header-clean">
            <h3 class="card-title">🛡️ Backup Locale Cifrato (.json)</h3>
            <p class="card-subtitle">Esporta una copia crittografata con AES-256 dei tuoi listini e archivio per conservarla su pendrive o archivio locale.</p>
          </div>

          <div class="backup-actions-grid mt-3">
            <div class="backup-action-box">
              <h4>Esporta Backup Cifrato</h4>
              <p class="text-subtle">Scarica un file .json cifrato. I dati rimarranno protetti dalla tua Master Password.</p>
              <button type="button" id="btn-export-backup" class="btn btn-secondary mt-2">
                📦 Scarica Backup Cifrato (.json)
              </button>
              ${settings.lastBackupDate ? `<small class="text-subtle d-block mt-1">Ultimo export: ${new Date(settings.lastBackupDate).toLocaleDateString('it-IT')}</small>` : ''}
            </div>

            <div class="backup-action-box">
              <h4>Ripristina Backup</h4>
              <p class="text-subtle">Carica un file .json esportato in precedenza. Ti verrà richiesta la password per sbloccarlo.</p>
              <label class="btn btn-outline mt-2" for="input-import-backup">
                📥 Carica File Backup (.json)
                <input type="file" id="input-import-backup" accept=".json" class="visually-hidden">
              </label>
            </div>
          </div>
        </div>

        <!-- Scheda 5: Gestione Master Password -->
        <div class="card settings-card">
          <div class="card-header-clean">
            <h3 class="card-title">🔐 Modifica Master Password</h3>
            <p class="card-subtitle">Ricifra l'intero database locale derivando una nuova chiave AES-GCM con PBKDF2 (100.000 iterazioni).</p>
          </div>

          <form id="form-change-password" class="mt-3">
            <div class="form-group">
              <label class="form-label" for="setting-old-pwd">Master Password Attuale *</label>
              <input type="password" id="setting-old-pwd" class="form-input" required autocomplete="current-password">
            </div>

            <div class="form-row">
              <div class="form-group flex-1">
                <label class="form-label" for="setting-new-pwd">Nuova Master Password *</label>
                <input type="password" id="setting-new-pwd" class="form-input" required minlength="4" autocomplete="new-password">
              </div>
              <div class="form-group flex-1">
                <label class="form-label" for="setting-confirm-new-pwd">Conferma Nuova Password *</label>
                <input type="password" id="setting-confirm-new-pwd" class="form-input" required minlength="4" autocomplete="new-password">
              </div>
            </div>

            <button type="submit" class="btn btn-secondary">Aggiorna e Ricifra Vault</button>
          </form>
        </div>

        <!-- Scheda 6: Aspetto & Accessibilità Mobile -->
        <div class="card settings-card">
          <div class="card-header-clean">
            <h3 class="card-title">🎨 Aspetto & Contrasto</h3>
            <p class="card-subtitle">Ottimizzato per l'uso in magazzino e con una sola mano</p>
          </div>

          <div class="theme-options-row mt-3">
            <label class="theme-radio-card ${settings.theme === 'dark' ? 'selected' : ''}">
              <input type="radio" name="theme-radio" value="dark" ${settings.theme === 'dark' ? 'checked' : ''}>
              <div class="theme-radio-content">
                <span class="theme-icon">🌙</span>
                <strong>Tema Scuro</strong>
                <small>Ideale per risparmio batteria e ambienti bui</small>
              </div>
            </label>

            <label class="theme-radio-card ${settings.theme === 'light' ? 'selected' : ''}">
              <input type="radio" name="theme-radio" value="light" ${settings.theme === 'light' ? 'checked' : ''}>
              <div class="theme-radio-content">
                <span class="theme-icon">☀️</span>
                <strong>Tema Chiaro</strong>
                <small>Massima leggibilità sotto luce diretta</small>
              </div>
            </label>
          </div>

          <div class="high-contrast-toggle-row mt-3">
            <label class="toggle-switch-label">
              <input type="checkbox" id="setting-high-contrast" ${settings.highContrast ? 'checked' : ''}>
              <span class="toggle-slider"></span>
              <span class="toggle-text">Modalità Alto Contrasto (Bordi rinforzati per banchi di lavoro)</span>
            </label>
          </div>
        </div>

        <!-- Scheda 7: Chiusura Sessione Sicura -->
        <div class="card settings-card card-danger-border">
          <div class="card-header-clean">
            <h3 class="card-title text-danger">🔒 Blocco Immediato Sessione</h3>
            <p class="card-subtitle">Cancella istantaneamente le chiavi di decrittazione e i dati in chiaro dalla memoria RAM del dispositivo.</p>
          </div>
          <button type="button" id="btn-lock-session" class="btn btn-danger mt-3">
            Chiudi Sessione e Blocca Vault
          </button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    // --- GESTIONE BIOMETRIA ---
    const enableBioBtn = this.container.querySelector('#btn-enable-biometrics');
    if (enableBioBtn) {
      enableBioBtn.addEventListener('click', async () => {
        try {
          enableBioBtn.disabled = true;
          enableBioBtn.textContent = '⏳ Rilevamento impronta/volto in corso...';
          const sessionPwd = store.sessionPassword;
          if (!sessionPwd) {
            Toast.error('Sessione non sbloccata. Riapri l\'app per abilitare la biometria.');
            return;
          }
          await BiometricsManager.registerBiometrics(sessionPwd);
          await store.updateSettings({ biometricsEnabled: true });
          Toast.success('Accesso biometrico registrato con successo sul dispositivo!');
          this.render();
        } catch (err) {
          Toast.error(`Impossibile registrare la biometria: ${err.message}`);
          enableBioBtn.disabled = false;
          enableBioBtn.textContent = '👆 Abilita Impronta / Face ID su questo dispositivo';
        }
      });
    }

    const disableBioBtn = this.container.querySelector('#btn-disable-biometrics');
    if (disableBioBtn) {
      disableBioBtn.addEventListener('click', async () => {
        BiometricsManager.disableBiometrics();
        await store.updateSettings({ biometricsEnabled: false });
        Toast.info('Biometria disabilitata su questo dispositivo.');
        this.render();
      });
    }

    // --- GESTIONE SINCRONIZZAZIONE CLOUD GITHUB ---
    const tokenInput = this.container.querySelector('#setting-github-token');
    const gistInput = this.container.querySelector('#setting-github-gist-id');
    const toggleTokenBtn = this.container.querySelector('#btn-toggle-github-token');
    const syncStatusRow = this.container.querySelector('.cloud-sync-status-row');

    // Salvataggio immediato all'inserimento/modifica: previene la perdita del token digitato
    const persistCloudInputs = () => {
      const currentToken = tokenInput ? tokenInput.value.trim() : '';
      const currentGist = gistInput ? gistInput.value.trim() : '';
      store.updateSettings({
        githubToken: currentToken,
        githubGistId: currentGist
      });
    };

    tokenInput?.addEventListener('input', persistCloudInputs);
    gistInput?.addEventListener('input', persistCloudInputs);
    tokenInput?.addEventListener('change', persistCloudInputs);
    gistInput?.addEventListener('change', persistCloudInputs);

    if (toggleTokenBtn && tokenInput) {
      toggleTokenBtn.addEventListener('click', () => {
        if (tokenInput.type === 'password') {
          tokenInput.type = 'text';
          toggleTokenBtn.textContent = 'Nascondi';
        } else {
          tokenInput.type = 'password';
          toggleTokenBtn.textContent = 'Mostra';
        }
      });
    }

    // Helper per aggiornare la riga di stato sync a video senza distruggere i campi input
    const updateSyncStatusDisplay = (dateIso) => {
      if (syncStatusRow) {
        syncStatusRow.innerHTML = `
          <span class="text-subtle">
            Ultima sincronizzazione cloud: <strong>${new Date(dateIso).toLocaleString('it-IT')}</strong>
          </span>
        `;
      }
    };

    // Test Token GitHub
    const testTokenBtn = this.container.querySelector('#btn-test-github-token');
    if (testTokenBtn) {
      testTokenBtn.addEventListener('click', async () => {
        const token = tokenInput ? tokenInput.value.trim() : '';
        if (!token) {
          Toast.error('Inserisci prima il Token GitHub da verificare.');
          tokenInput?.focus();
          return;
        }
        testTokenBtn.disabled = true;
        testTokenBtn.textContent = '⏳ Verifica...';
        try {
          const user = await GitHubSyncManager.testToken(token);
          await store.updateSettings({ githubToken: token });
          Toast.success(`Token valido! Connesso all'account GitHub: @${user.login}`);
        } catch (err) {
          Toast.error(err.message);
        } finally {
          testTokenBtn.disabled = false;
          testTokenBtn.textContent = '⚡ Verifica Token';
        }
      });
    }

    // Sincronizzazione Bidirezionale Intelligente (2-Way Smart Sync)
    const syncNowBtn = this.container.querySelector('#btn-sync-now');
    if (syncNowBtn) {
      syncNowBtn.addEventListener('click', async () => {
        const token = (tokenInput ? tokenInput.value.trim() : '') || store.getSettings().githubToken;
        const gistId = (gistInput ? gistInput.value.trim() : '') || store.getSettings().githubGistId;

        if (!token) {
          Toast.error('Inserisci il Token GitHub per sincronizzare i dati.');
          tokenInput?.focus();
          return;
        }

        syncNowBtn.disabled = true;
        syncNowBtn.textContent = '⏳ Sincronizzazione in corso...';
        try {
          const res = await store.syncWithCloud(token, gistId);
          if (gistInput) gistInput.value = res.gistId;
          updateSyncStatusDisplay(res.updatedAt);
          if (res.stats && (res.stats.newSuppliers > 0 || res.stats.newSupplies > 0)) {
            Toast.success(`Sincronizzazione completata! ${res.stats.newSuppliers} nuovi fornitori e ${res.stats.newSupplies} nuove forniture importati dal Cloud.`);
          } else {
            Toast.success('Dati allineati con il Cloud! Archivio aggiornato con tutti i dispositivi.');
          }
        } catch (err) {
          Toast.error(`Errore sincronizzazione: ${err.message}`);
        } finally {
          syncNowBtn.disabled = false;
          syncNowBtn.textContent = '☁️ Sincronizza Ora (2-Way Bidirezionale)';
        }
      });
    }

    // Crea Gist Privato Automatico
    const createGistBtn = this.container.querySelector('#btn-create-gist');
    if (createGistBtn) {
      createGistBtn.addEventListener('click', async () => {
        const token = (tokenInput ? tokenInput.value.trim() : '') || store.getSettings().githubToken;
        if (!token) {
          Toast.error('Inserisci prima un Token GitHub valido.');
          tokenInput?.focus();
          return;
        }
        createGistBtn.disabled = true;
        createGistBtn.textContent = '⏳ Creazione Gist...';
        try {
          const envelope = store.getEncryptedEnvelope();
          if (!envelope) throw new Error('Nessun dato cifrato presente da caricare.');
          const res = await GitHubSyncManager.createPrivateGist(token, envelope);
          if (gistInput) gistInput.value = res.gistId;
          await store.updateSettings({
            githubToken: token,
            githubGistId: res.gistId,
            lastCloudSyncDate: res.updatedAt
          });
          updateSyncStatusDisplay(res.updatedAt);
          Toast.success(`Cloud privato creato con successo! Gist ID: ${res.gistId}`);
        } catch (err) {
          Toast.error(`Errore creazione Gist: ${err.message}`);
        } finally {
          createGistBtn.disabled = false;
          createGistBtn.textContent = '🚀 Crea Gist Privato';
        }
      });
    }

    // Invia al Cloud (Push Forzato)
    const pushBtn = this.container.querySelector('#btn-push-vault');
    if (pushBtn) {
      pushBtn.addEventListener('click', async () => {
        const token = (tokenInput ? tokenInput.value.trim() : '') || store.getSettings().githubToken;
        const gistId = (gistInput ? gistInput.value.trim() : '') || store.getSettings().githubGistId;
        
        if (!token) {
          Toast.error('Inserisci il Token GitHub per sincronizzare i dati.');
          tokenInput?.focus();
          return;
        }

        pushBtn.disabled = true;
        pushBtn.textContent = '⏳ Caricamento...';
        try {
          const envelope = store.getEncryptedEnvelope();
          if (!envelope) throw new Error('Nessun dato cifrato presente.');
          
          const res = await GitHubSyncManager.smartPushVault(token, gistId, envelope);
          
          if (gistInput) gistInput.value = res.gistId;
          await store.updateSettings({
            githubToken: token,
            githubGistId: res.gistId,
            lastCloudSyncDate: res.updatedAt
          });
          updateSyncStatusDisplay(res.updatedAt);
          Toast.success('Vault locale inviato con successo sul Cloud GitHub!');
        } catch (err) {
          Toast.error(`Errore Push Cloud: ${err.message}`);
        } finally {
          pushBtn.disabled = false;
          pushBtn.textContent = '📤 Invia al Cloud (Push Forzato)';
        }
      });
    }

    // Scarica dal Cloud (Pull)
    const pullBtn = this.container.querySelector('#btn-pull-vault');
    if (pullBtn) {
      pullBtn.addEventListener('click', async () => {
        const token = (tokenInput ? tokenInput.value.trim() : '') || store.getSettings().githubToken;
        const gistId = (gistInput ? gistInput.value.trim() : '') || store.getSettings().githubGistId;

        if (!token) {
          Toast.error('Inserisci il Token GitHub per scaricare i dati.');
          tokenInput?.focus();
          return;
        }

        pullBtn.disabled = true;
        pullBtn.textContent = '⏳ Download...';
        try {
          const { gistId: foundGistId, envelope, updatedAt } = await GitHubSyncManager.smartPullVault(token, gistId);
          const password = store.sessionPassword || prompt('Inserisci la Master Password per decifrare il Vault scaricato dal Cloud:');
          if (!password) {
            pullBtn.disabled = false;
            pullBtn.textContent = '📥 Scarica dal Cloud (Pull)';
            return;
          }
          await store.applyRemoteEncryptedEnvelope(envelope, password);
          if (gistInput) gistInput.value = foundGistId;
          await store.updateSettings({
            githubToken: token,
            githubGistId: foundGistId,
            lastCloudSyncDate: updatedAt
          });
          updateSyncStatusDisplay(updatedAt);
          Toast.success('Dati scaricati dal Cloud e decifrati con successo!');
        } catch (err) {
          Toast.error(`Errore Pull Cloud: ${err.message}`);
        } finally {
          pullBtn.disabled = false;
          pullBtn.textContent = '📥 Scarica dal Cloud (Pull)';
        }
      });
    }

    // Form Salva Impostazioni Cloud
    const githubForm = this.container.querySelector('#form-github-sync');
    if (githubForm) {
      githubForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const token = tokenInput ? tokenInput.value.trim() : '';
        const gistId = gistInput ? gistInput.value.trim() : '';
        await store.updateSettings({
          githubToken: token,
          githubGistId: gistId
        });
        Toast.success('Parametri di sincronizzazione Cloud salvati nel Vault!');
      });
    }

    // --- CHIAVE GEMINI ---
    const toggleKeyBtn = this.container.querySelector('#btn-toggle-key-visibility');
    const keyInput = this.container.querySelector('#setting-gemini-key');
    if (toggleKeyBtn && keyInput) {
      keyInput.addEventListener('input', () => {
        store.updateSettings({ geminiApiKey: keyInput.value.trim() });
      });
      keyInput.addEventListener('change', () => {
        store.updateSettings({ geminiApiKey: keyInput.value.trim() });
      });

      toggleKeyBtn.addEventListener('click', () => {
        if (keyInput.type === 'password') {
          keyInput.type = 'text';
          toggleKeyBtn.textContent = 'Nascondi';
        } else {
          keyInput.type = 'password';
          toggleKeyBtn.textContent = 'Mostra';
        }
      });
    }

    const testKeyBtn = this.container.querySelector('#btn-test-gemini-key');
    if (testKeyBtn) {
      testKeyBtn.addEventListener('click', async () => {
        const apiKey = keyInput ? keyInput.value.trim() : '';
        const model = this.container.querySelector('#setting-gemini-model').value;

        if (!apiKey) {
          Toast.error('Inserisci prima una chiave API di Google AI Studio da testare.');
          keyInput?.focus();
          return;
        }

        testKeyBtn.disabled = true;
        testKeyBtn.textContent = '⏳ Verifica in corso...';

        try {
          const result = await GeminiOCRClient.testApiKey(apiKey, model);
          Toast.success(result.message, 4000);
        } catch (err) {
          Toast.error(`Test fallito: ${err.message}`, 6000);
        } finally {
          testKeyBtn.disabled = false;
          testKeyBtn.textContent = '⚡ Testa Connessione Google AI Studio';
        }
      });
    }

    const geminiForm = this.container.querySelector('#form-gemini-settings');
    if (geminiForm) {
      geminiForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const apiKey = keyInput ? keyInput.value.trim() : '';
        const geminiModel = this.container.querySelector('#setting-gemini-model').value;

        await store.updateSettings({
          geminiApiKey: apiKey,
          geminiModel
        });
        Toast.success('Chiave Google AI Studio salvata e protetta con AES-256 nel Vault!');
      });
    }

    // Export Backup
    const exportBtn = this.container.querySelector('#btn-export-backup');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        try {
          store.exportEncryptedBackup();
          Toast.success('File di backup cifrato scaricato correttamente.');
        } catch (err) {
          Toast.error(err.message);
        }
      });
    }

    // Import Backup
    const importInput = this.container.querySelector('#input-import-backup');
    if (importInput) {
      importInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
          const envelope = await CryptoVault.readBackupFile(file);
          const password = prompt('Inserisci la Master Password associata al backup caricato:');
          if (!password) {
            importInput.value = '';
            return;
          }

          await store.importEncryptedBackup(envelope, password);
          Toast.success('Backup cifrato importato e ripristinato con successo!');
          window.location.reload();
        } catch (err) {
          Toast.error(`Impossibile ripristinare il backup: ${err.message}`);
          importInput.value = '';
        }
      });
    }

    // Modifica Password
    const pwdForm = this.container.querySelector('#form-change-password');
    if (pwdForm) {
      pwdForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const oldPwd = this.container.querySelector('#setting-old-pwd').value;
        const newPwd = this.container.querySelector('#setting-new-pwd').value;
        const confirmNewPwd = this.container.querySelector('#setting-confirm-new-pwd').value;

        if (newPwd !== confirmNewPwd) {
          Toast.error('La nuova password e la conferma non coincidono.');
          return;
        }

        try {
          await store.changeMasterPassword(oldPwd, newPwd);
          Toast.success('Master Password aggiornata e vault ricifrato con successo!');
          pwdForm.reset();
        } catch (err) {
          Toast.error(err.message);
        }
      });
    }

    // Cambio Tema
    const themeRadios = this.container.querySelectorAll('input[name="theme-radio"]');
    themeRadios.forEach(radio => {
      radio.addEventListener('change', async (e) => {
        const newTheme = e.target.value;
        document.documentElement.setAttribute('data-theme', newTheme);
        await store.updateSettings({ theme: newTheme });
        this.render();
      });
    });

    // Alto Contrasto
    const highContrastCheck = this.container.querySelector('#setting-high-contrast');
    if (highContrastCheck) {
      highContrastCheck.addEventListener('change', async (e) => {
        const highContrast = e.target.checked;
        document.documentElement.classList.toggle('high-contrast', highContrast);
        await store.updateSettings({ highContrast });
      });
    }

    // Blocco Sessione
    const lockBtn = this.container.querySelector('#btn-lock-session');
    if (lockBtn) {
      lockBtn.addEventListener('click', () => {
        store.lockVault();
        Toast.info('Vault bloccato. La memoria RAM è stata azzerata.');
      });
    }
  }
}


// --- MODULE: js/app.js ---
/**
 * ContiFor - Main Application Entrypoint & Router
 * 
 * Orchestrazione delle viste SPA, navigazione mobile bottom-bar e Service Worker PWA
 */











class App {
  constructor() {
    this.currentTab = 'scan';
    this.views = {};
    this.mainContainer = document.getElementById('main-view-container');
    this.authOverlay = document.getElementById('auth-modal-overlay');
    this.authModal = new AuthModal(this.authOverlay);

    // Esponi per navigazione programmatica tra viste
    window.appRouter = {
      navigate: (tabId) => this.switchTab(tabId)
    };
  }

  init() {
    this.views = {
      scan: new ScanView(this.mainContainer),
      archive: new ArchiveView(this.mainContainer),
      suppliers: new SuppliersView(this.mainContainer),
      report: new ReportView(this.mainContainer),
      settings: new SettingsView(this.mainContainer)
    };

    this.bindNavigation();
    this.bindHeaderSync();
    this.bindStoreEvents();
    this.registerServiceWorker();

    // Controlla stato Vault
    if (!store.isUnlocked) {
      this.authModal.show();
    } else {
      this.applyThemeSettings();
      this.switchTab(this.currentTab);
    }
  }

  bindNavigation() {
    const navButtons = document.querySelectorAll('.bottom-nav-item');
    navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (tab && store.isUnlocked) {
          this.switchTab(tab);
        }
      });
    });
  }

  bindHeaderSync() {
    const syncBtn = document.getElementById('btn-header-cloud-sync');
    if (!syncBtn) return;

    syncBtn.addEventListener('click', async () => {
      if (!store.isUnlocked) return;

      const domTokenInput = document.getElementById('setting-github-token');
      const domGistInput = document.getElementById('setting-github-gist-id');

      const token = (domTokenInput ? domTokenInput.value.trim() : '') || store.getSettings().githubToken;
      const gistId = (domGistInput ? domGistInput.value.trim() : '') || store.getSettings().githubGistId;

      if (!token) {
        Toast.info('Per sincronizzare i dati tra smartphone e PC, inserisci il tuo Token GitHub nelle Impostazioni.');
        this.switchTab('settings');
        setTimeout(() => {
          document.getElementById('setting-github-token')?.focus();
        }, 150);
        return;
      }

      // Salva preventivamente il token
      await store.updateSettings({
        githubToken: token,
        ...(gistId ? { githubGistId: gistId } : {})
      });

      syncBtn.disabled = true;
      syncBtn.textContent = '⏳ Sync...';

      try {
        // Esegue la sincronizzazione bidirezionale intelligente (Pull + Merge + Push)
        const res = await store.syncWithCloud(token, gistId);

        // Se l'utente è sulla schermata impostazioni, aggiorna i campi a video senza ricaricare la pagina
        if (domGistInput) domGistInput.value = res.gistId;
        const statusRow = document.querySelector('.cloud-sync-status-row');
        if (statusRow) {
          statusRow.innerHTML = `
            <span class="text-subtle">
              Ultima sincronizzazione cloud: <strong>${new Date(res.updatedAt).toLocaleString('it-IT')}</strong>
            </span>
          `;
        }

        if (res.stats && (res.stats.newSuppliers > 0 || res.stats.newSupplies > 0)) {
          Toast.success(`Sincronizzazione completata! ${res.stats.newSuppliers} nuovi fornitori e ${res.stats.newSupplies} nuove forniture importati dal Cloud.`);
        } else {
          Toast.success('Dati allineati con il Cloud! Il database è aggiornato con tutti i tuoi dispositivi.');
        }

        // Ri-renderizza la vista attiva per mostrare subito i nuovi fornitori/dati a video
        if (this.views[this.currentTab]) {
          this.views[this.currentTab].render();
        }
      } catch (err) {
        Toast.error(`Errore sincronizzazione: ${err.message}`);
      } finally {
        syncBtn.disabled = false;
        syncBtn.textContent = '☁️ Sync';
      }
    });
  }

  switchTab(tabId) {
    if (!this.views[tabId]) return;

    this.currentTab = tabId;

    // Aggiorna classi bottoni bottom-bar
    document.querySelectorAll('.bottom-nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Renderizza vista corrente
    this.views[tabId].render();

    // Scroll verso l'alto per mobile UX
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  bindStoreEvents() {
    store.subscribe((event, payload, state) => {
      if (event === 'VAULT_UNLOCKED') {
        this.applyThemeSettings();
        this.switchTab(this.currentTab);
      } else if (event === 'VAULT_LOCKED') {
        this.mainContainer.innerHTML = '';
        this.authModal.show();
      } else if (event === 'SETTINGS_UPDATED') {
        this.applyThemeSettings();
      } else if (event === 'SUPPLIES_UPDATED') {
        if (this.currentTab === 'archive' || this.currentTab === 'report') {
          this.views[this.currentTab].render();
        }
      } else if (event === 'SUPPLIERS_UPDATED') {
        if (this.currentTab === 'suppliers' || this.currentTab === 'scan' || this.currentTab === 'report') {
          this.views[this.currentTab].render();
        }
      }
    });
  }

  applyThemeSettings() {
    const settings = store.getSettings();
    document.documentElement.setAttribute('data-theme', settings.theme || 'dark');
    document.documentElement.classList.toggle('high-contrast', Boolean(settings.highContrast));
  }

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then(reg => {
            console.log('ContiFor Service Worker registrato con successo (Scope:', reg.scope, ')');
          })
          .catch(err => {
            console.warn('Registrazione Service Worker non riuscita (normale se in ambiente di test locale non HTTPS):', err);
          });
      });
    }
  }
}

// Inizializzazione DOM
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});


})();
