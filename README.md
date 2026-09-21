# ContiFor - PWA Mobile-First Gestione Forniture & OCR Manoscritto

**ContiFor** è un'applicazione web standalone mobile-first ad elevata sicurezza (configurata come Progressive Web App – PWA e file statico pronto per GitHub Pages), progettata per semplificare e velocizzare la gestione di forniture, bolle e appunti manoscritti per ristoranti, negozi di ortofrutta, magazzini e attività commerciali.

---

## Caratteristiche Principali

1. **Sicurezza e Privacy "Zero-Cloud"**:
   - Nessun database remoto o server esterno.
   - Tutti i dati risiedono esclusivamente nel browser del dispositivo dell'utente (`localStorage`).
   - Cifratura client-side **AES-GCM a 256-bit** con derivazione chiavi **PBKDF2** (100.000 iterazioni, SHA-256 e salt crittografico casuale).
   - In memoria RAM risiedono solo durante la sessione attiva; blocco istantaneo a comando.
   - Funzioni integrate di **Esporta Backup Cifrato (.json)** e **Importa Backup Cifrato**.

2. **OCR Multimodale Gemini Vision**:
   - Integrazione diretta con le API Google Gemini (`gemini-3.8-flash` e fallback `gemini-3.6-flash` / `gemini-flash-latest`).
   - System prompt ingegnerizzato per trascrivere note e numeri manoscritti, con regole per disambiguare grafie complesse (distinzione tra 1 e 7, virgole/punti decimali, cancellature e pesi multipli).
   - Risposta JSON rigorosamente strutturata (`response_mime_type: "application/json"`).
   - Rigoroso rispetto della privacy: all'endpoint di Gemini viene inviata unicamente l'immagine acquisita. Nessun dato storico, fornitore o prezzo memorizzato viene mai esposto verso l'esterno.

3. **Verifica Interattiva Human-in-the-Loop**:
   - Layout mobile-first con anteprima foto e griglia di verifica modificabile.
   - Modifica istantanea con feedback touch di pesi, prodotti o prezzi.
   - Calcolo automatico in tempo reale di quantità/pesi totali e totale fornitura in Euro (€).
   - Associazione automatica con il listino prezzi del fornitore selezionato.

4. **Anagrafica Fornitori e Listini Dinamici**:
   - Creazione, modifica ed eliminazione fornitori.
   - Listino prezzi personalizzato per prodotto (unità di misura, prezzo unitario in €).
   - Duplicazione rapida dei listini e modifica veloce dei prezzi.

5. **Archivio Storico & Esportazione**:
   - Cronologia completa delle forniture con filtri per fornitore, intervallo date e ricerca full-text.
   - Scheda di dettaglio analitica per ciascuna fornitura.
   - Esportazione in formato **CSV compatibile con Microsoft Excel** (BOM UTF-8 e separatore punto e virgola).

6. **Dashboard Analitica & Confronto Selettivo Costi**:
   - KPI aggregate: Totale spesa, Forniture effettuate, Costo medio per fornitura, Volumi movimentati.
   - **Filtro Fornitori Selettivo (Multi-select)**: possibilità di isolare solo i fornitori desiderati per un confronto mirato (es. Fornitore A vs Fornitore B).
   - Grafici vettoriali interattivi SVG nativi (100% offline-ready, zero dipendenze CDN esterne):
     - *Andamento Mensile per Fornitore*.
     - *Ripartizione a Ciambella (%) dell'incidenza sui costi*.
     - *Tabella Comparativa Fornitori*.

7. **PWA Mobile-First & Accessibilità**:
   - Bottom Navigation Bar ottimizzata per l'uso verticale con il pollice su smartphone.
   - Supporto **Dark Mode**, **Light Mode** e **Modalità Alto Contrasto** ideale per magazzini e ambienti operativi.
   - `manifest.json` e Service Worker configurati per il caching offline completo della shell grafica.

---

## Struttura del Progetto

```
conti_for/
├── index.html              # Shell HTML principale e mount point SPA
├── manifest.json           # Manifest PWA per installazione come app nativa
├── sw.js                   # Service Worker per caching offline
├── README.md               # Documentazione del progetto
├── assets/
│   └── icon.svg            # Icona vettoriale dell'applicazione
├── css/
│   ├── main.css            # Layout base e tipografia mobile-first
│   ├── components.css      # Componenti UI, cards, bottoni, tabelle touch, modali
│   └── themes.css          # Variabili tema Dark/Light e alto contrasto
├── js/
│   ├── app.js              # Entrypoint applicativo, router e registrazione SW
│   ├── crypto/
│   │   └── vault.js        # Modulo Web Crypto API (PBKDF2 100k, AES-GCM 256)
│   ├── gemini/
│   │   └── geminiClient.js # Client multimodale Gemini Vision con schema JSON
│   ├── store/
│   │   └── state.js        # State manager reattivo e persistenza cifrata
│   ├── ui/
│   │   ├── charts.js       # Motore grafici SVG nativo offline
│   │   └── toast.js        # Notifiche toast touch-friendly
│   └── views/
│       ├── authModal.js    # Schermata di sblocco e inizializzazione Vault
│       ├── scanView.js     # Fotocamera, OCR Gemini e verifica Human-in-the-Loop
│       ├── archiveView.js  # Archivio storico forniture ed export CSV
│       ├── suppliersView.js# Anagrafica fornitori e listini prezzi
│       ├── reportView.js   # Dashboard e confronto selettivo fornitori
│       └── settingsView.js # Impostazioni, Gemini Key, backup cifrato e tema
└── test/
    └── test_core.mjs       # Test automatizzati crittografia e schema Gemini
```

---

## Come Avviare l'Applicazione

### 1. Esecuzione Locale Immediata

Poiché l'applicazione è sviluppata in JavaScript standard (ES6 Modules) senza necessità di transpiler o bundler pesanti, è sufficiente avviare un qualsiasi web server locale:

```bash
# Opzione A: Con Node.js (npx serve)
npx serve .

# Opzione B: Con Python
python -m http.server 8080
```

Apri poi il browser all'indirizzo `http://localhost:8080` (o `http://localhost:3000`).

### 2. Pubblicazione su GitHub Pages

L'applicazione è pronta all'uso al 100% per GitHub Pages:
1. Crea un repository su GitHub e carica tutti i file della cartella `conti_for`.
2. Vai su **Settings** > **Pages**.
3. Sotto **Build and deployment**, seleziona il branch `main` e la cartella `/ (root)`.
4. Clicca **Save**: la tua applicazione sarà disponibile online su un URL HTTPS sicuro (es. `https://tuo-utente.github.io/conti_for/`).

---

## Installazione come PWA su Smartphone

- **Android (Chrome)**: Apri il sito web, tocca il menu con i tre puntini in alto a destra e seleziona **"Aggiungi a schermata Home"** o **"Installa app"**.
- **iOS (Safari)**: Apri il sito web, tocca il pulsante **Condividi** (quadrato con freccia verso l'alto) e seleziona **"Aggiungi alla schermata Home"**.

L'icona di ContiFor apparirà sul display dello smartphone comportandosi come un'app nativa a tutto schermo, funzionante anche senza connessione internet per tutte le operazioni locali.

---

## Configurazione della Chiave API di Google AI Studio

1. Accedi al portale gratuito di **[Google AI Studio (Get API Key)](https://aistudio.google.com/app/apikey)** con il tuo account Google.
2. Clicca su **"Create API key"** (oppure copia una chiave già creata).
3. Apri **ContiFor** sullo smartphone o sul PC, tocca l'icona **Setup (Impostazioni)** in basso a destra.
4. Incolla la tua chiave nel campo **"Chiave API Google AI Studio"**.
5. Clicca sul pulsante **"⚡ Testa Connessione Google AI Studio"**: riceverai immediatamente la conferma visiva di validità.
6. Clicca su **"💾 Salva Chiave nel Vault Cifrato"**: la tua chiave verrà cifrata con **AES-GCM a 256 bit** e salvata in locale nel dispositivo protetto dalla tua Master Password.

> **Zero-Cloud & Privacy**: La chiave non viene mai trasmessa a server terzi o intermedi. L'app contatta esclusivamente i server ufficiali di Google Generative Language quando scatti una foto per l'estrazione OCR.
