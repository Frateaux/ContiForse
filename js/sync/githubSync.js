/**
 * ContiFor - GitHub Zero-Knowledge Cloud Sync (Modulo Sincronizzazione Smartphone ⇄ Desktop)
 * 
 * Sincronizza il Vault cifrato AES-256 su un GitHub Gist privato tramite le API ufficiali di GitHub.
 * NESSUN dato in chiaro viene mai inviato in rete.
 */

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
}
