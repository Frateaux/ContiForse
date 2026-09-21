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
      const settings = store.getSettings();
      const token = settings.githubToken;
      const gistId = settings.githubGistId;

      if (!token || !gistId) {
        Toast.info('Per sincronizzare i dati tra smartphone e PC, inserisci il tuo Token GitHub nelle Impostazioni.');
        this.switchTab('settings');
        return;
      }

      syncBtn.disabled = true;
      syncBtn.textContent = '⏳ Sync...';

      try {
        const envelope = store.getEncryptedEnvelope();
        const res = await GitHubSyncManager.pushVault(token, gistId, envelope);
        await store.updateSettings({ lastCloudSyncDate: res.updatedAt });
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
