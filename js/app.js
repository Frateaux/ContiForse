/**
 * ContiFor - Main Application Entrypoint & Router
 * 
 * Orchestrazione delle viste SPA, navigazione mobile bottom-bar e Service Worker PWA
 */

import { store } from './store/state.js';
import { AuthModal } from './views/authModal.js';
import { ScanView } from './views/scanView.js';
import { ArchiveView } from './views/archiveView.js';
import { SuppliersView } from './views/suppliersView.js';
import { ReportView } from './views/reportView.js';
import { SettingsView } from './views/settingsView.js';
import { GitHubSyncManager } from './sync/githubSync.js';
import { Toast } from './ui/toast.js';

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
        const envelope = store.getEncryptedEnvelope();
        if (!envelope) throw new Error('Nessun dato cifrato presente da sincronizzare.');

        // smartPushVault crea o individua automaticamente il Gist se non impostato
        const res = await GitHubSyncManager.smartPushVault(token, gistId, envelope);

        await store.updateSettings({
          githubToken: token,
          githubGistId: res.gistId,
          lastCloudSyncDate: res.updatedAt
        });

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

        Toast.success('Sincronizzazione Cloud completata con successo!');
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
