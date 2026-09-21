/**
 * ContiFor - Settings View
 * 
 * Gestione Gemini API Key, Accesso Biometrico (WebAuthn), Sincronizzazione Cloud Cifrata (GitHub Gist),
 * Backup Cifrato, Master Password, Aspetto e Blocco Vault
 */

import { store } from '../store/state.js';
import { CryptoVault } from '../crypto/vault.js';
import { Toast } from '../ui/toast.js';
import { GeminiOCRClient } from '../gemini/geminiClient.js';
import { BiometricsManager } from '../crypto/biometrics.js';
import { GitHubSyncManager } from '../sync/githubSync.js';

export class SettingsView {
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
              <button type="button" id="btn-test-github-token" class="btn btn-outline">
                ⚡ Verifica Token
              </button>
              <button type="button" id="btn-create-gist" class="btn btn-secondary">
                🚀 Crea Gist Privato Automatico
              </button>
              <button type="button" id="btn-push-vault" class="btn btn-primary">
                ☁️ Invia al Cloud (Push)
              </button>
              <button type="button" id="btn-pull-vault" class="btn btn-outline">
                📥 Scarica dal Cloud (Pull)
              </button>
              <button type="submit" class="btn btn-subtle">
                💾 Salva Configurazione Cloud
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
          createGistBtn.textContent = '🚀 Crea Gist Privato Automatico';
        }
      });
    }

    // Invia al Cloud (Push)
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
        pushBtn.textContent = '⏳ Sincronizzazione...';
        try {
          const envelope = store.getEncryptedEnvelope();
          if (!envelope) throw new Error('Nessun dato cifrato presente.');
          
          // smartPushVault cerca o crea automaticamente il Gist se non specificato
          const res = await GitHubSyncManager.smartPushVault(token, gistId, envelope);
          
          if (gistInput) gistInput.value = res.gistId;
          await store.updateSettings({
            githubToken: token,
            githubGistId: res.gistId,
            lastCloudSyncDate: res.updatedAt
          });
          updateSyncStatusDisplay(res.updatedAt);
          Toast.success('Vault cifrato caricato con successo sul Cloud GitHub!');
        } catch (err) {
          Toast.error(`Errore Push Cloud: ${err.message}`);
        } finally {
          pushBtn.disabled = false;
          pushBtn.textContent = '☁️ Invia al Cloud (Push)';
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
          Toast.success('Dati scaricati dal Cloud e decifrati con successo!');
          setTimeout(() => {
            window.location.reload();
          }, 600);
        } catch (err) {
          Toast.error(`Errore Pull Cloud: ${err.message}`);
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
