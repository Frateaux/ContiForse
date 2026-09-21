/**
 * ContiFor - GitHub Zero-Knowledge Cloud Sync (Modulo Sincronizzazione Smartphone ⇄ Desktop)
 * 
 * Sincronizza il Vault cifrato AES-256 su un GitHub Gist privato tramite le API ufficiali di GitHub.
 * NESSUN dato in chiaro viene mai inviato in rete.
 */

import { CryptoVault } from '../crypto/vault.js';

export class GitHubSyncManager {
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
