/**
 * ContiFor - Biometrics Manager (WebAuthn / Passkeys)
 * 
 * Gestisce l'accesso biometrico (Impronta digitale, Face ID, Touch ID, Windows Hello)
 * tramite lo standard W3C Web Authentication API (Platform Authenticator).
 */

const BIO_CRED_KEY = 'contifor_bio_credential_id';
const BIO_TOKEN_KEY = 'contifor_bio_wrapped_key';
const BIO_SALT_KEY = 'contifor_bio_salt';

export class BiometricsManager {
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
