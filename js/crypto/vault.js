/**
 * ContiFor - Modulo Crittografico Client-Side (Web Crypto API)
 * 
 * Specifiche di sicurezza:
 * - PBKDF2 per Key Derivation con SHA-256 e 100.000 iterazioni.
 * - Cifratura simmetrica AES-GCM a 256-bit con IV casuale a 96-bit (12 bytes) per ogni scrittura.
 * - Nessuna chiave esportabile (in-memory non estraibile).
 * - Zero-Cloud: tutti i dati rimangono cifrati in locale.
 */

export class CryptoVault {
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
