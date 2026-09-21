/**
 * ContiFor - Store & State Management
 * 
 * Gestisce:
 * - Stato applicativo reattivo in memoria.
 * - Ciclo di vita del Vault crittografato (lock/unlock).
 * - Persistenza sicura su localStorage tramite CryptoVault.
 * - Operazioni CRUD su Fornitori, Listini, Storico Forniture e Impostazioni.
 */

import { CryptoVault } from '../crypto/vault.js';

const STORAGE_KEY = 'contifor_vault_encrypted';

export class AppStore {
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

export const store = new AppStore();
