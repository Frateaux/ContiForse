/**
 * ContiFor - Settings View
 * 
 * Gestione Gemini API Key, Backup Cifrato, Master Password, Aspetto e Blocco Vault
 */

import { store } from '../store/state.js';
import { CryptoVault } from '../crypto/vault.js';
import { Toast } from '../ui/toast.js';
import { GeminiOCRClient } from '../gemini/geminiClient.js';

export class SettingsView {
  constructor(container) {
    this.container = container;
  }

  render() {
    const settings = store.getSettings();

    this.container.innerHTML = `
      <div class="view-header">
        <div>
          <h1 class="view-title">Impostazioni & Sicurezza</h1>
          <p class="view-subtitle">Configurazione crittografica, Gemini API e backup del vault</p>
        </div>
      </div>

      <div class="settings-container">
        <!-- Scheda 1: Chiave API Google AI Studio -->
        <div class="card settings-card">
          <div class="card-header-clean">
            <h3 class="card-title">🔑 Chiave API Google AI Studio</h3>
            <p class="card-subtitle">Inserisci la tua chiave generata su Google AI Studio per l'analisi OCR dei manoscritti con Gemini Flash. La chiave viene cifrata con AES-256 nel tuo vault locale.</p>
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

        <!-- Scheda 2: Backup e Ripristino Cifrato (Zero-Cloud) -->
        <div class="card settings-card">
          <div class="card-header-clean">
            <h3 class="card-title">🛡️ Backup Cifrato (.json)</h3>
            <p class="card-subtitle">Esporta una copia crittografata con AES-256 dei tuoi listini e archivio per conservarla su pendrive o migrare dispositivo.</p>
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

        <!-- Scheda 3: Gestione Master Password -->
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

        <!-- Scheda 4: Aspetto & Accessibilità Mobile -->
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

        <!-- Scheda 5: Chiusura Sessione Sicura -->
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
    // Visibilità Chiave API
    const toggleKeyBtn = this.container.querySelector('#btn-toggle-key-visibility');
    const keyInput = this.container.querySelector('#setting-gemini-key');
    if (toggleKeyBtn && keyInput) {
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

    // Test Connessione Google AI Studio
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

    // Salva Chiave e Modello nel Vault Cifrato
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
