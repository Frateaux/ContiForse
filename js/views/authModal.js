/**
 * ContiFor - Auth & Unlock Modal
 * 
 * Gestisce il primo avvio (creazione Vault) e lo sblocco con Master Password
 */

import { store } from '../store/state.js';
import { CryptoVault } from '../crypto/vault.js';
import { Toast } from '../ui/toast.js';
import { BiometricsManager } from '../crypto/biometrics.js';

export class AuthModal {
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
        </form>

        <div class="auth-footer">
          <div class="security-pills">
            <span class="sec-pill">🔒 AES-GCM 256-bit</span>
            <span class="sec-pill">⚡ PBKDF2 100k</span>
            <span class="sec-pill">🛡️ Zero-Cloud</span>
          </div>
          ${isInitialized ? `
            <div class="auth-restore-hint mt-2">
              <label class="btn-link" for="auth-restore-file">
                Hai un backup cifrato? <strong>Ripristina da .json</strong>
                <input type="file" id="auth-restore-file" accept=".json" class="visually-hidden">
              </label>
            </div>
          ` : ''}
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
  }
}
