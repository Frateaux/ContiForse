/**
 * ContiFor - Scan View (Moduli B & C)
 * 
 * Acquisizione Appunti Manoscritti, Scansione Rapida (Pesi & Calcoli),
 * Inserimento a Mano Rapido, OCR Standalone Locale (Zero-Cloud) & Gemini AI,
 * Audit Matematico Automatico, Validazione Fornitore Obbligatoria & Generazione Fattura PDF A4.
 */

import { store } from '../store/state.js';
import { GeminiOCRClient } from '../gemini/geminiClient.js';
import { LocalOCREngine } from '../ocr/localOcrEngine.js';
import { Toast } from '../ui/toast.js';
import { InvoiceGenerator } from '../ui/invoiceGenerator.js';
import { PendingScansStorage } from '../storage/pendingScansStorage.js';

export class ScanView {
  constructor(container) {
    this.container = container;
    this.scanMode = 'quick'; // 'quick' (Pesi & Calcoli) | 'standard' (Con Listino) | 'manual' (Inserimento a Mano)
    this.ocrEngine = 'local'; // 'local' (Standalone Offline Zero-Cloud) | 'gemini' (Google AI Studio Cloud)
    this.currentImageBase64 = null;
    this.currentMimeType = 'image/jpeg';
    this.isProcessing = false;
    this.extractedItems = [];
    this.selectedSupplierId = null;
    this.customSupplierName = '';
    this.documentDate = new Date().toISOString().split('T')[0];
    this.documentTitle = '';
    this.notes = '';
    this.detectedGrandTotal = null;
    this.detectedAdditionsCount = 0;
    this.detectedMultiplicationsCount = 0;
    this.pendingScans = [];
    this.activePendingScanId = null;
  }

  render() {
    const suppliers = store.getSuppliers();
    if (!this.selectedSupplierId && suppliers.length > 0) {
      this.selectedSupplierId = suppliers[0].id;
    }

    this.container.innerHTML = `
      <div class="view-header">
        <div>
          <h1 class="view-title">Scansione & Controllo Aritmetico</h1>
          <p class="view-subtitle">Rileva pesi, moltiplicazioni e somme. Convalida e genera la fattura PDF.</p>
        </div>
      </div>

      <div class="scan-container">
        <!-- Barra di selezione Modalità Scansione / Inserimento -->
        <div class="scan-mode-tabs">
          <button type="button" class="scan-mode-btn ${this.scanMode === 'quick' ? 'active' : ''}" data-mode="quick">
            <span class="mode-icon">⚡</span>
            <div>
              <strong>Scansione Rapida</strong>
              <small class="d-block">Controllo pesi, addizioni e moltiplicazioni</small>
            </div>
          </button>
          <button type="button" class="scan-mode-btn ${this.scanMode === 'standard' ? 'active' : ''}" data-mode="standard">
            <span class="mode-icon">📋</span>
            <div>
              <strong>Scansione con Listino</strong>
              <small class="d-block">Associazione prezzi da catalogo fornitore</small>
            </div>
          </button>
          <button type="button" class="scan-mode-btn ${this.scanMode === 'manual' ? 'active' : ''}" data-mode="manual">
            <span class="mode-icon">✍️</span>
            <div>
              <strong>Inserimento a Mano</strong>
              <small class="d-block">Digitazione rapida pesi e catalogo fornitore</small>
            </div>
          </button>
        </div>

        <!-- Coda Foto in Sospeso (persistenti su disco se Gemini ha troppe richieste) -->
        <div id="pending-scans-container"></div>

        <!-- Pannello Configurazione Fornitore & Data -->
        <div class="card scan-setup-card mt-3">
          <div class="form-row">
            <!-- Selezione o Inserimento Fornitore Obbligatorio -->
            <div class="form-group flex-2" id="supplier-selection-group">
              <label class="form-label font-weight-bold" for="scan-supplier-select">
                Fornitore Associato <span class="text-danger">* Obbligatorio</span>
              </label>
              <div class="supplier-input-combo">
                <select id="scan-supplier-select" class="form-select flex-1">
                  <option value="">-- Seleziona Fornitore Esistente --</option>
                  ${suppliers.map(s => `
                    <option value="${s.id}" ${s.id === this.selectedSupplierId ? 'selected' : ''}>
                      ${s.name} (${s.priceList?.length || 0} prodotti a listino)
                    </option>
                  `).join('')}
                </select>
                <input type="text" id="scan-custom-supplier-input" class="form-input flex-1" 
                  placeholder="Oppure scrivi nome nuovo fornitore..." value="${this.customSupplierName}">
              </div>
              <small class="form-text-hint text-subtle">
                È richiesto il nome del fornitore per convalidare e stampare la fattura/ricevuta.
              </small>
            </div>

            <div class="form-group flex-1">
              <label class="form-label" for="scan-date-input">Data Consegna</label>
              <input type="date" id="scan-date-input" class="form-input" value="${this.documentDate}">
            </div>
          </div>

          ${this.scanMode === 'manual' ? `
            <!-- Pannello Inserimento a Mano Rapido -->
            <div class="manual-entry-card mt-2">
              <div class="d-flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h4 class="card-title font-weight-bold">✍️ Modalità Inserimento Diretto</h4>
                  <p class="card-subtitle">Aggiungi articoli al volo dal listino oppure incolla blocchi di pesi e conti.</p>
                </div>
                <button type="button" id="btn-manual-add-empty" class="btn btn-outline btn-sm">
                  ➕ Aggiungi Riga Vuota
                </button>
              </div>

              <!-- Chips Articoli Rapidi da Listino Fornitore -->
              ${this.renderSupplierCatalogChips()}

              <!-- Parser Testuale Veloce per incollare blocchi di calcoli -->
              <div class="batch-paste-box mt-3">
                <label class="form-label font-weight-bold" for="manual-batch-textarea">
                  📋 Incolla o scrivi righe di appunti / pesi (Parser Automatico)
                </label>
                <textarea id="manual-batch-textarea" class="batch-paste-textarea" 
                  placeholder="Es:&#10;Pomodori 12.4 + 13.1 = 25.5 * 2.20&#10;Patate 50 * 0.95&#10;Zucchine 7.8 * 1.80&#10;Insalata 4 casse * 12.50&#10;Totale: 207.96"></textarea>
                <div class="d-flex justify-between items-center mt-2 flex-wrap gap-2">
                  <small class="text-subtle">Riconosce somme pesi (+), moltiplicazioni (* o x) e totali riga.</small>
                  <button type="button" id="btn-parse-batch-text" class="btn btn-primary btn-sm">
                    📥 Inserisci in Tabella
                  </button>
                </div>
              </div>
            </div>
          ` : `
            <!-- Selettore Motore OCR: Standalone Locale vs Gemini Cloud -->
            <div class="ocr-engine-selector">
              <span class="font-weight-bold">⚡ Motore OCR:</span>
              <div class="ocr-engine-options">
                <label class="ocr-engine-radio-label">
                  <input type="radio" name="ocr-engine-choice" value="local" ${this.ocrEngine === 'local' ? 'checked' : ''}>
                  <span>🖥️ <strong>OCR Locale Standalone</strong> <small class="text-success">(Nessun limite / Zero-Cloud)</small></span>
                </label>
                <label class="ocr-engine-radio-label">
                  <input type="radio" name="ocr-engine-choice" value="gemini" ${this.ocrEngine === 'gemini' ? 'checked' : ''}>
                  <span>☁️ <strong>Gemini AI Cloud</strong> <small class="text-subtle">(Richiede API Key)</small></span>
                </label>
              </div>
            </div>

            <!-- Pulsanti Acquisizione Touch -->
            <div class="camera-actions-row mt-3">
              <label class="btn btn-primary btn-camera" for="camera-file-input">
                <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                  <circle cx="12" cy="13" r="4"></circle>
                </svg>
                <span>Fotocamera</span>
                <input type="file" id="camera-file-input" accept="image/*" capture="environment" class="visually-hidden">
              </label>

              <label class="btn btn-secondary btn-gallery" for="gallery-file-input">
                <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                  <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                <span>Galleria / File</span>
                <input type="file" id="gallery-file-input" accept="image/*" class="visually-hidden">
              </label>

              <button type="button" id="btn-demo-sample" class="btn btn-outline" title="Carica un appunto di prova con pesi, somme e moltiplicazioni">
                <span>Carica Esempio Calcoli Demo</span>
              </button>
            </div>
          `}
        </div>

        <!-- Barra di Caricamento / Analisi AI -->
        <div id="ai-loading-state" class="card ai-processing-card ${this.isProcessing ? '' : 'hidden'}">
          <div class="spinner"></div>
          <div class="ai-processing-text">
            <h4 id="ai-processing-status-text">
              ${this.ocrEngine === 'local' ? 'Elaborazione OCR Locale Standalone in corso...' : 'Elaborazione Gemini Vision Flash in corso...'}
            </h4>
            <p>Trascrizione grafia, verifica delle moltiplicazioni (Q.tà × Prezzo) e quadratura delle addizioni dei pesi.</p>
          </div>
        </div>

        <!-- Card Errore & Tasto Riprova Istantaneo con la stessa foto -->
        <div id="ai-error-state" class="card ai-error-card hidden mt-3">
          <div class="ai-error-banner">
            <div class="ai-error-icon">⚠️</div>
            <div class="ai-error-content flex-1">
              <h4 class="ai-error-title" id="ai-error-title">Elaborazione non riuscita</h4>
              <p class="ai-error-desc" id="ai-error-desc">
                Google AI Studio ha riscontrato un rallentamento o troppe richieste contemporanee (Rate Limit 429).
              </p>
              <div class="ai-error-hint mt-2">
                💾 <strong>La foto è salvata automaticamente sul dispositivo:</strong> puoi riprovare con l'OCR Locale Standalone (senza limiti), riprovare con Gemini o ritrovarla in seguito tra le foto in sospeso.
              </div>
            </div>
          </div>
          <div class="ai-error-actions mt-3 d-flex gap-2 flex-wrap">
            <button type="button" class="btn btn-primary" id="btn-fallback-local-ocr">
              🖥️ Elabora Subito con OCR Locale Standalone (Nessun Limite)
            </button>
            <button type="button" class="btn btn-outline" id="btn-retry-scan">
              🔄 Riprova con Gemini AI
            </button>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-keep-pending">
              💾 Conserva tra le Foto in Sospeso
            </button>
            <button type="button" class="btn btn-danger btn-sm" id="btn-delete-active-pending">
              🗑️ Elimina Questa Foto
            </button>
            <button type="button" class="btn btn-subtle btn-sm" id="btn-dismiss-error">
              Nascondi avviso
            </button>
          </div>
        </div>

        <!-- Sezione Revisione Human-in-the-Loop & Audit Matematico -->
        <div id="human-in-the-loop-section" class="${this.scanMode === 'manual' || this.currentImageBase64 || this.extractedItems.length > 0 ? '' : 'hidden'}">
          
          <!-- Box Anteprima Immagine Zoomabile (visibile solo se c'è un'immagine acquisita) -->
          <div class="card image-preview-card mt-3 ${this.currentImageBase64 ? '' : 'hidden'}">
            <div class="preview-header">
              <div class="preview-title">
                <span class="badge badge-info">Appunto Acquisito</span>
                <span id="preview-filename-label" class="text-subtle">Manoscritto originale</span>
              </div>
              <div class="preview-tools">
                <button type="button" id="btn-toggle-img-collapse" class="btn btn-sm btn-subtle" title="Espandi/Riduci foto">
                  ↕️ Riduci/Espandi
                </button>
              </div>
            </div>
            <div id="image-preview-wrapper" class="preview-img-wrapper">
              <img id="scanned-image-preview" src="${this.currentImageBase64 ? `data:${this.currentMimeType};base64,${this.currentImageBase64}` : ''}" alt="Foto foglio manoscritto">
            </div>
          </div>

          <!-- Card Audit Matematico & Controllo Calcoli -->
          <div class="card math-audit-card mt-3" id="math-audit-panel">
            <!-- Popolato dinamicamente da updateMathAuditUI() -->
          </div>

          <!-- Modulo C: Tabella Editabile con Feedback Touch e Ricalcolo Istantaneo -->
          <div class="card review-table-card mt-3">
            <div class="review-table-header">
              <div>
                <h3 class="card-title">Verifica Voci & Controllo Pesi (Human-in-the-Loop)</h3>
                <p class="card-subtitle">Modifica qualsiasi valore. Inserisci pesi sommati es: "12.4 + 13.1". I subtotali si calcolano in tempo reale.</p>
              </div>
              <button type="button" id="btn-add-item-row" class="btn btn-sm btn-outline">
                ➕ Aggiungi Riga
              </button>
            </div>

            <div class="table-responsive">
              <table class="items-table" id="review-items-table">
                <thead>
                  <tr>
                    <th style="width: 32%;">Prodotto / Dettaglio Pesi</th>
                    <th style="width: 18%;">Q.tà / Peso</th>
                    <th style="width: 14%;">U.M.</th>
                    <th style="width: 18%;">Prezzo Unit. (€)</th>
                    <th style="width: 18%;">Subtotale (€)</th>
                    <th style="width: 40px;"></th>
                  </tr>
                </thead>
                <tbody id="review-items-tbody">
                  <!-- Righe dinamiche popolate da renderTableRows() -->
                </tbody>
              </table>
            </div>

            <!-- Note addizionali documento -->
            <div class="form-row mt-3">
              <div class="form-group flex-1">
                <label class="form-label" for="review-doc-title">Riferimento / N. Documento</label>
                <input type="text" id="review-doc-title" class="form-input" placeholder="Es. Bolla del 21/09 o Scarico Pesi" value="${this.documentTitle}">
              </div>
              <div class="form-group flex-2">
                <label class="form-label" for="review-doc-notes">Note Fornitura</label>
                <input type="text" id="review-doc-notes" class="form-input" placeholder="Es. Controllo pesi effettuato su bilancia..." value="${this.notes}">
              </div>
            </div>

            <!-- Riepilogo Totali Calcolati Istantaneamente -->
            <div class="totals-summary-bar">
              <div class="summary-metric">
                <span class="summary-metric-label">Righe Totali:</span>
                <span class="summary-metric-value" id="total-rows-val">0</span>
              </div>
              <div class="summary-metric">
                <span class="summary-metric-label">Quantità / Peso Totale:</span>
                <span class="summary-metric-value" id="total-qty-val">0.00</span>
              </div>
              <div class="summary-metric metric-grand-total">
                <span class="summary-metric-label">TOTALE FORNITURA:</span>
                <span class="summary-metric-value total-euro" id="grand-total-val">€ 0,00</span>
              </div>
            </div>

            <!-- Pulsante Conferma, Convalida e Genera Fattura PDF -->
            <div class="review-actions-bar">
              <button type="button" id="btn-cancel-scan" class="btn btn-secondary">
                Annulla
              </button>
              <button type="button" id="btn-confirm-supply" class="btn btn-primary btn-lg">
                <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                  <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
                <span>Convalida & Genera Fattura PDF</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
    if (this.scanMode === 'manual' && this.extractedItems.length === 0) {
      this.addNewRow();
    } else {
      this.renderTableRows();
      this.updateMathAuditUI();
    }
  }

  renderSupplierCatalogChips() {
    const supplier = store.getSupplierById(this.selectedSupplierId);
    const catalog = supplier?.priceList || [];
    if (catalog.length === 0) {
      return `
        <div class="catalog-chips-wrapper mt-3">
          <small class="text-subtle">
            Nessun articolo censito a listino per questo fornitore. Puoi aggiungere righe a mano con il pulsante sopra o censire i prodotti nella sezione Fornitori.
          </small>
        </div>
      `;
    }

    return `
      <div class="catalog-chips-wrapper mt-3">
        <label class="form-label font-weight-bold">Tocca un articolo a listino per aggiungerlo subito:</label>
        <div class="catalog-chips-list">
          ${catalog.map(c => `
            <button type="button" class="catalog-chip-btn" data-name="${c.name}" data-price="${c.unitPrice}" data-unit="${c.unit || 'kg'}">
              <span>➕ ${c.name}</span>
              <span class="catalog-chip-price">€ ${Number(c.unitPrice).toFixed(2)}/${c.unit || 'kg'}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  bindEvents() {
    // Cambio modalità di scansione (Rapida vs Standard vs Inserimento a Mano)
    const modeBtns = this.container.querySelectorAll('.scan-mode-btn');
    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.scanMode = btn.dataset.mode;
        this.render();
      });
    });

    // Selettore Motore OCR
    const ocrRadios = this.container.querySelectorAll('input[name="ocr-engine-choice"]');
    ocrRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.ocrEngine = e.target.value;
      });
    });

    const supplierSelect = this.container.querySelector('#scan-supplier-select');
    if (supplierSelect) {
      supplierSelect.addEventListener('change', (e) => {
        this.selectedSupplierId = e.target.value;
        const group = this.container.querySelector('#supplier-selection-group');
        if (group) group.classList.remove('supplier-required-error');
        if (this.scanMode === 'standard') {
          this.updatePricesFromSupplierListino();
        } else if (this.scanMode === 'manual') {
          this.render();
        }
      });
    }

    const customSupplierInput = this.container.querySelector('#scan-custom-supplier-input');
    if (customSupplierInput) {
      customSupplierInput.addEventListener('input', (e) => {
        this.customSupplierName = e.target.value;
        const group = this.container.querySelector('#supplier-selection-group');
        if (group) group.classList.remove('supplier-required-error');
      });
    }

    const dateInput = this.container.querySelector('#scan-date-input');
    if (dateInput) {
      dateInput.addEventListener('change', (e) => {
        this.documentDate = e.target.value;
      });
    }

    const cameraInput = this.container.querySelector('#camera-file-input');
    if (cameraInput) {
      cameraInput.addEventListener('change', (e) => this.handleImageSelected(e.target.files[0]));
    }

    const galleryInput = this.container.querySelector('#gallery-file-input');
    if (galleryInput) {
      galleryInput.addEventListener('change', (e) => this.handleImageSelected(e.target.files[0]));
    }

    const demoBtn = this.container.querySelector('#btn-demo-sample');
    if (demoBtn) {
      demoBtn.addEventListener('click', () => this.loadDemoSample());
    }

    const addRowBtn = this.container.querySelector('#btn-add-item-row');
    if (addRowBtn) {
      addRowBtn.addEventListener('click', () => this.addNewRow());
    }

    // Modalità Manuale: aggiungi riga vuota
    const manualAddEmptyBtn = this.container.querySelector('#btn-manual-add-empty');
    if (manualAddEmptyBtn) {
      manualAddEmptyBtn.addEventListener('click', () => {
        this.addNewRow();
        this.showReviewSection();
      });
    }

    // Modalità Manuale: Chip Articoli da listino
    const chipBtns = this.container.querySelectorAll('.catalog-chip-btn');
    chipBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.name;
        const price = parseFloat(btn.dataset.price) || 0;
        const unit = btn.dataset.unit || 'kg';
        this.extractedItems.push({
          productName: name,
          quantity: 1,
          sub_weights: [],
          unit: unit,
          unitPrice: price,
          subtotal: price,
          declared_row_total: null,
          calculation_expression: '',
          notes: ''
        });
        this.showReviewSection();
        this.renderTableRows();
        this.updateMathAuditUI();
        Toast.info(`Aggiunto ${name} a listino (€ ${price.toFixed(2)})`);
      });
    });

    // Modalità Manuale: Parser blocchi di testo
    const parseBatchBtn = this.container.querySelector('#btn-parse-batch-text');
    if (parseBatchBtn) {
      parseBatchBtn.addEventListener('click', () => {
        const textarea = this.container.querySelector('#manual-batch-textarea');
        const text = textarea?.value?.trim();
        if (!text) {
          Toast.warning('Scrivi o incolla prima delle righe di calcoli o pesi.');
          return;
        }

        const supplier = store.getSupplierById(this.selectedSupplierId);
        const catalogNames = (supplier?.priceList || []).map(p => p.name);
        const ocrResult = LocalOCREngine.parseOcrText(text, catalogNames);

        if (ocrResult.items && ocrResult.items.length > 0) {
          // Se avevamo solo una riga vuota iniziale, sostituiscila
          if (this.extractedItems.length === 1 && this.extractedItems[0].productName === 'Nuovo Articolo' && this.extractedItems[0].unitPrice === 0) {
            this.extractedItems = [];
          }
          this.processOCRResult(ocrResult);
          textarea.value = '';
          Toast.success(`Riconosciute ed aggiunte ${ocrResult.items.length} voci con successo!`);
        } else {
          Toast.warning('Nessuna riga di calcolo o peso riconosciuta. Prova ad inserire es: "Pomodori 12.4 + 13.1 = 25.5 * 2.20"');
        }
      });
    }

    const confirmBtn = this.container.querySelector('#btn-confirm-supply');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => this.confirmAndSaveSupply());
    }

    const cancelBtn = this.container.querySelector('#btn-cancel-scan');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.resetScan());
    }

    const toggleCollapseBtn = this.container.querySelector('#btn-toggle-img-collapse');
    if (toggleCollapseBtn) {
      toggleCollapseBtn.addEventListener('click', () => {
        const wrapper = this.container.querySelector('#image-preview-wrapper');
        if (wrapper) wrapper.classList.toggle('collapsed');
      });
    }

    // Fallback OCR Standalone Locale su errore Gemini
    const fallbackLocalOcrBtn = this.container.querySelector('#btn-fallback-local-ocr');
    if (fallbackLocalOcrBtn) {
      fallbackLocalOcrBtn.addEventListener('click', async () => {
        this.ocrEngine = 'local';
        const radio = this.container.querySelector('input[name="ocr-engine-choice"][value="local"]');
        if (radio) radio.checked = true;
        await this.executeOcrAnalysis();
      });
    }

    const retryBtn = this.container.querySelector('#btn-retry-scan');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        this.executeOcrAnalysis();
      });
    }

    const keepPendingBtn = this.container.querySelector('#btn-keep-pending');
    if (keepPendingBtn) {
      keepPendingBtn.addEventListener('click', () => {
        this.hideErrorCard();
        this.currentImageBase64 = null;
        this.extractedItems = [];
        const section = this.container.querySelector('#human-in-the-loop-section');
        if (section && this.scanMode !== 'manual') section.classList.add('hidden');
        this.loadAndRenderPendingScans();
        Toast.info('Foto conservata negli scatti in sospeso. Puoi continuare o chiudere l\'app.');
      });
    }

    const deleteActiveBtn = this.container.querySelector('#btn-delete-active-pending');
    if (deleteActiveBtn) {
      deleteActiveBtn.addEventListener('click', async () => {
        if (this.activePendingScanId) {
          await PendingScansStorage.delete(this.activePendingScanId);
          this.activePendingScanId = null;
        }
        this.resetScan();
        await this.loadAndRenderPendingScans();
        Toast.info('Foto eliminata.');
      });
    }

    const dismissBtn = this.container.querySelector('#btn-dismiss-error');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        this.hideErrorCard();
      });
    }

    // Carica gli scatti precedentemente salvati in sospeso
    this.loadAndRenderPendingScans();
  }

  /**
   * Carica e visualizza la coda degli scatti in sospeso (es. bloccati da troppe richieste Gemini)
   */
  async loadAndRenderPendingScans() {
    const container = this.container.querySelector('#pending-scans-container');
    if (!container) return;

    try {
      this.pendingScans = await PendingScansStorage.getAll();
    } catch (e) {
      this.pendingScans = [];
    }

    if (this.pendingScans.length === 0) {
      container.innerHTML = '';
      return;
    }

    const suppliers = store.getSuppliers();
    const getSupName = (supId) => {
      const s = suppliers.find(x => x.id === supId);
      return s ? s.name : null;
    };

    container.innerHTML = `
      <div class="card pending-scans-card mt-3">
        <div class="card-header-clean d-flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 class="card-title text-warning">📸 Foto in Sospeso (${this.pendingScans.length})</h3>
            <p class="card-subtitle">Scatti conservati sul dispositivo non elaborati subito (es. troppe richieste Gemini). Puoi riprovare ora o eliminarli.</p>
          </div>
          <span class="badge badge-warning">${this.pendingScans.length} in sospeso</span>
        </div>

        <div class="pending-scans-list mt-3">
          ${this.pendingScans.map(item => `
            <div class="pending-scan-item p-3 mb-2" data-id="${item.id}">
              <div class="d-flex items-center gap-3 flex-wrap">
                <img src="data:${item.mimeType};base64,${item.imageBase64}" 
                     class="pending-scan-thumb" 
                     alt="Anteprima foto" 
                     title="Clicca per visualizzare nell'anteprima grande">
                <div class="pending-scan-info flex-1">
                  <strong>${item.customSupplierName || getSupName(item.supplierId) || 'Fornitore non specificato'}</strong>
                  <small class="d-block text-subtle">
                    Scattata il ${new Date(item.createdAt).toLocaleString('it-IT')} • Modalità: ${item.scanMode === 'quick' ? 'Rapida (Pesi & Calcoli)' : 'Con Listino'}
                  </small>
                  ${item.errorMessage ? `<small class="text-danger d-block mt-1 font-weight-bold">⚠️ ${item.errorMessage}</small>` : ''}
                </div>
                <div class="pending-scan-actions">
                  <button type="button" class="btn btn-primary btn-sm btn-process-pending-local" data-id="${item.id}" title="Elabora senza connessione né limiti">
                    🖥️ Elabora Locale
                  </button>
                  <button type="button" class="btn btn-outline btn-sm btn-process-pending-gemini" data-id="${item.id}" title="Elabora con Google Gemini AI Studio">
                    ☁️ Elabora Gemini
                  </button>
                  <button type="button" class="btn btn-danger btn-sm btn-delete-pending" data-id="${item.id}">
                    🗑️ Elimina
                  </button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Helper per avviare elaborazione scatto in sospeso
    const launchPendingScan = async (id, chosenEngine) => {
      const item = this.pendingScans.find(s => s.id === id);
      if (!item) return;

      this.activePendingScanId = item.id;
      this.currentImageBase64 = item.imageBase64;
      this.currentMimeType = item.mimeType;
      this.selectedSupplierId = item.supplierId || this.selectedSupplierId;
      this.customSupplierName = item.customSupplierName || '';
      this.scanMode = item.scanMode || 'quick';
      this.documentDate = item.documentDate || this.documentDate;
      this.ocrEngine = chosenEngine;

      const supSelect = this.container.querySelector('#scan-supplier-select');
      if (supSelect) supSelect.value = this.selectedSupplierId || '';
      const customInput = this.container.querySelector('#scan-custom-supplier-input');
      if (customInput) customInput.value = this.customSupplierName;
      const dateInput = this.container.querySelector('#scan-date-input');
      if (dateInput) dateInput.value = this.documentDate;

      const radio = this.container.querySelector(`input[name="ocr-engine-choice"][value="${chosenEngine}"]`);
      if (radio) radio.checked = true;

      const imgEl = this.container.querySelector('#scanned-image-preview');
      if (imgEl) imgEl.src = `data:${item.mimeType};base64,${item.imageBase64}`;
      this.showImagePreviewSection();

      Toast.info(`Elaborazione foto in sospeso con ${chosenEngine === 'local' ? 'OCR Standalone Locale' : 'Gemini AI'}...`);
      await this.executeOcrAnalysis();
    };

    // Handler elaborazione locale
    container.querySelectorAll('.btn-process-pending-local').forEach(btn => {
      btn.addEventListener('click', (e) => launchPendingScan(e.currentTarget.dataset.id, 'local'));
    });

    // Handler elaborazione gemini
    container.querySelectorAll('.btn-process-pending-gemini').forEach(btn => {
      btn.addEventListener('click', (e) => launchPendingScan(e.currentTarget.dataset.id, 'gemini'));
    });

    // Handler per cancellazione scatto in sospeso
    container.querySelectorAll('.btn-delete-pending').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        if (confirm('Vuoi davvero eliminare questa foto memorizzata?')) {
          await PendingScansStorage.delete(id);
          if (this.activePendingScanId === id) {
            this.resetScan();
          }
          await this.loadAndRenderPendingScans();
          Toast.info('Foto eliminata dagli scatti in sospeso.');
        }
      });
    });

    // Clic miniatura per ingrandire
    container.querySelectorAll('.pending-scan-thumb').forEach(thumb => {
      thumb.addEventListener('click', (e) => {
        const parent = e.target.closest('.pending-scan-item');
        const id = parent?.dataset.id;
        const item = this.pendingScans.find(s => s.id === id);
        if (item) {
          const imgEl = this.container.querySelector('#scanned-image-preview');
          if (imgEl) imgEl.src = `data:${item.mimeType};base64,${item.imageBase64}`;
          this.showImagePreviewSection();
          const previewCard = this.container.querySelector('.image-preview-card');
          previewCard?.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
  }

  async handleImageSelected(file) {
    if (!file) return;

    try {
      this.hideErrorCard();
      this.updateProcessingUI(true);
      const { base64, mimeType } = await GeminiOCRClient.compressImage(file);
      this.currentImageBase64 = base64;
      this.currentMimeType = mimeType;
      this.activePendingScanId = null;

      const imgEl = this.container.querySelector('#scanned-image-preview');
      if (imgEl) imgEl.src = `data:${mimeType};base64,${base64}`;
      this.showImagePreviewSection();

      await this.executeOcrAnalysis();
    } catch (err) {
      console.error('Errore durante il caricamento o compressione:', err);
      this.updateProcessingUI(false);
      this.showErrorCard(err.message, 'local');
      Toast.error(`Errore caricamento: ${err.message}`);
    }
  }

  /**
   * Esegue o riprova l'analisi OCR sfruttando l'immagine già conservata in memoria o su disco
   */
  async executeOcrAnalysis() {
    if (!this.currentImageBase64) {
      Toast.warning('Nessuna immagine presente da elaborare.');
      return;
    }

    this.hideErrorCard();
    this.updateProcessingUI(true);

    const supplier = store.getSupplierById(this.selectedSupplierId);
    const catalogNames = (supplier?.priceList || []).map(p => p.name);

    // MOTORE 1: OCR Locale Standalone (Zero-Cloud, nessun limite di quota)
    if (this.ocrEngine === 'local') {
      try {
        const rawText = await LocalOCREngine.recognizeImage(
          this.currentImageBase64,
          (progress) => {
            const statusEl = this.container.querySelector('#ai-processing-status-text');
            if (statusEl && progress.message) {
              statusEl.textContent = progress.message;
            }
          }
        );

        const ocrResult = LocalOCREngine.parseOcrText(rawText, catalogNames);
        this.processOCRResult(ocrResult);

        // Se era un elemento in sospeso salvato in precedenza, rimuovilo
        if (this.activePendingScanId) {
          await PendingScansStorage.delete(this.activePendingScanId);
          this.activePendingScanId = null;
          await this.loadAndRenderPendingScans();
        }

        Toast.success('Riconoscimento OCR Locale e controllo calcoli completati!');
      } catch (err) {
        console.error('Errore durante OCR Locale:', err);
        this.showErrorCard(err.message, 'local');
        Toast.error(`Errore OCR Locale: ${err.message}`);
      } finally {
        this.updateProcessingUI(false);
      }
      return;
    }

    // MOTORE 2: Gemini AI Cloud
    try {
      const settings = store.getSettings();
      const apiKey = settings?.geminiApiKey;
      const targetModel = 'gemini-3.8-flash';

      const ocrResult = await GeminiOCRClient.analyzeHandwrittenNote({
        imageBase64: this.currentImageBase64,
        mimeType: this.currentMimeType,
        apiKey,
        model: targetModel,
        productCatalog: catalogNames
      });

      this.processOCRResult(ocrResult);

      // Se era un elemento in sospeso salvato in precedenza, rimuovilo dalla coda
      if (this.activePendingScanId) {
        await PendingScansStorage.delete(this.activePendingScanId);
        this.activePendingScanId = null;
        await this.loadAndRenderPendingScans();
      }

      Toast.success('Analisi Gemini AI e controllo aritmetico completati!');
    } catch (err) {
      console.error('Errore durante la scansione Gemini:', err);

      // Persistenza automatica della foto su storage
      try {
        const saved = await PendingScansStorage.save({
          id: this.activePendingScanId || undefined,
          imageBase64: this.currentImageBase64,
          mimeType: this.currentMimeType,
          supplierId: this.selectedSupplierId,
          customSupplierName: this.customSupplierName,
          scanMode: this.scanMode,
          documentDate: this.documentDate,
          errorMessage: err.message || 'Gemini ha troppe richieste al momento (Rate Limit 429)'
        });
        this.activePendingScanId = saved.id;
        await this.loadAndRenderPendingScans();
      } catch (saveErr) {
        console.warn('Errore salvataggio automatico foto in sospeso:', saveErr);
      }

      this.showErrorCard(err.message, 'gemini');
      Toast.error(`Errore Gemini: ${err.message}`);
    } finally {
      this.updateProcessingUI(false);
    }
  }

  showImagePreviewSection() {
    const section = this.container.querySelector('#human-in-the-loop-section');
    if (section) section.classList.remove('hidden');
    const previewCard = this.container.querySelector('.image-preview-card');
    if (previewCard && this.currentImageBase64) previewCard.classList.remove('hidden');
    const wrapper = this.container.querySelector('#image-preview-wrapper');
    if (wrapper) wrapper.classList.remove('collapsed');
  }

  showErrorCard(errorMessage = '') {
    const errorCard = this.container.querySelector('#ai-error-state');
    const titleEl = this.container.querySelector('#ai-error-title');
    const descEl = this.container.querySelector('#ai-error-desc');
    if (!errorCard) return;

    const lower = (errorMessage || '').toLowerCase();
    const isRateLimit = lower.includes('429') || 
                        lower.includes('troppe richieste') || 
                        lower.includes('resource exhausted') ||
                        lower.includes('quota');

    if (isRateLimit) {
      if (titleEl) titleEl.textContent = 'Gemini ha troppe richieste al momento (Rate Limit 429)';
      if (descEl) descEl.textContent = 'I server di Google AI Studio sono temporaneamente congestionati. La tua foto è al sicuro in memoria: attendi qualche secondo e tocca "Riprova Scansione Subito" qui sotto senza dover rifare la foto.';
    } else {
      if (titleEl) titleEl.textContent = 'Elaborazione non riuscita';
      if (descEl) descEl.textContent = errorMessage || 'Si è verificato un errore durante la connessione con Google AI Studio.';
    }

    errorCard.classList.remove('hidden');
    this.showImagePreviewSection();
  }

  hideErrorCard() {
    const errorCard = this.container.querySelector('#ai-error-state');
    if (errorCard) errorCard.classList.add('hidden');
  }

  processOCRResult(result) {
    if (!result) return;

    this.documentDate = result.document_date || this.documentDate;
    this.documentTitle = result.document_title || this.documentTitle;
    this.detectedGrandTotal = typeof result.declared_grand_total === 'number' ? result.declared_grand_total : null;
    this.detectedAdditionsCount = result.math_audit?.detected_additions_count || 0;
    this.detectedMultiplicationsCount = result.math_audit?.detected_multiplications_count || 0;

    // Se Gemini ha riconosciuto un nome fornitore scritto sul foglio, pre-impostalo
    if (result.detected_supplier_name && !this.selectedSupplierId && !this.customSupplierName) {
      const suppliers = store.getSuppliers();
      const match = suppliers.find(s => s.name.toLowerCase().includes(result.detected_supplier_name.toLowerCase()));
      if (match) {
        this.selectedSupplierId = match.id;
        const sel = this.container.querySelector('#scan-supplier-select');
        if (sel) sel.value = match.id;
      } else {
        this.customSupplierName = result.detected_supplier_name;
        const inp = this.container.querySelector('#scan-custom-supplier-input');
        if (inp) inp.value = this.customSupplierName;
      }
    }

    const supplier = store.getSupplierById(this.selectedSupplierId);
    const catalog = supplier?.priceList || [];

    const rawItems = Array.isArray(result.items) ? result.items : [];
    this.extractedItems = rawItems.map(rawItem => {
      const rawName = (rawItem.product_name || 'Articolo').trim();
      const parsedQty = parseFloat(rawItem.quantity) || 1;
      const cleanUnit = (rawItem.unit || 'kg').toLowerCase();

      let match = null;
      if (this.scanMode === 'standard' && catalog.length > 0) {
        match = catalog.find(c => 
          c.name.toLowerCase() === rawName.toLowerCase() ||
          rawName.toLowerCase().includes(c.name.toLowerCase())
        );
      }

      const unitPrice = match ? match.unitPrice : (parseFloat(rawItem.unit_price) || 0);
      const unit = match ? match.unit : cleanUnit;
      const productName = match ? match.name : rawName;
      const subtotal = Math.round(parsedQty * unitPrice * 100) / 100;

      return {
        productName,
        quantity: parsedQty,
        sub_weights: Array.isArray(rawItem.sub_weights) ? rawItem.sub_weights : [],
        unit,
        unitPrice,
        subtotal,
        declared_row_total: typeof rawItem.declared_row_total === 'number' ? rawItem.declared_row_total : null,
        calculation_expression: rawItem.calculation_expression || '',
        notes: rawItem.notes || ''
      };
    });

    if (this.extractedItems.length === 0) {
      this.extractedItems.push({
        productName: 'Nuovo Articolo',
        quantity: 1,
        sub_weights: [],
        unit: 'kg',
        unitPrice: 0,
        subtotal: 0,
        declared_row_total: null,
        calculation_expression: '',
        notes: ''
      });
    }

    this.showReviewSection();
    this.renderTableRows();
    this.updateMathAuditUI();
  }

  showReviewSection() {
    const section = this.container.querySelector('#human-in-the-loop-section');
    if (section) section.classList.remove('hidden');
  }

  updateProcessingUI(loading) {
    this.isProcessing = loading;
    const loader = this.container.querySelector('#ai-loading-state');
    if (loader) {
      if (loading) loader.classList.remove('hidden');
      else loader.classList.add('hidden');
    }
  }

  /**
   * Esegue l'audit aritmetico su moltiplicazioni, serie di pesi e totale documento
   */
  runMathAudit() {
    const discrepancies = [];
    let checkedMultiplications = 0;
    let checkedAdditions = 0;

    let grandTotalCalculated = 0;

    this.extractedItems.forEach((item, index) => {
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unitPrice) || 0;
      const calculatedSubtotal = Math.round(qty * price * 100) / 100;
      grandTotalCalculated += calculatedSubtotal;

      // 1. Controllo moltiplicazione: Q * P vs subtotale scritto sul foglio
      if (item.declared_row_total !== null && item.declared_row_total !== undefined) {
        checkedMultiplications++;
        const diff = Math.round((calculatedSubtotal - item.declared_row_total) * 100) / 100;
        if (Math.abs(diff) > 0.01) {
          discrepancies.push({
            type: 'multiplication',
            index,
            productName: item.productName,
            declared: item.declared_row_total,
            calculated: calculatedSubtotal,
            diff,
            msg: `Riga ${index + 1} (${item.productName}): scritto sul foglio € ${item.declared_row_total.toFixed(2)}, ma ${qty} × € ${price.toFixed(2)} = € ${calculatedSubtotal.toFixed(2)} (Scostamento: ${diff > 0 ? '+' : ''}${diff.toFixed(2)}€)`
          });
        }
      }

      // 2. Controllo addizione pesi parziali se presenti
      if (Array.isArray(item.sub_weights) && item.sub_weights.length > 1) {
        checkedAdditions++;
        const sumWeights = Math.round(item.sub_weights.reduce((s, w) => s + (parseFloat(w) || 0), 0) * 100) / 100;
        const diffWeights = Math.round((qty - sumWeights) * 100) / 100;
        if (Math.abs(diffWeights) > 0.01) {
          discrepancies.push({
            type: 'addition',
            index,
            productName: item.productName,
            declared: qty,
            calculated: sumWeights,
            diff: diffWeights,
            msg: `Riga ${index + 1} (${item.productName}): somma pesi parziali (${item.sub_weights.join(' + ')}) = ${sumWeights.toFixed(2)} kg vs quantità riportata ${qty.toFixed(2)} kg`
          });
        }
      }
    });

    // 3. Controllo totale complessivo documento
    if (this.detectedGrandTotal !== null && this.detectedGrandTotal !== undefined) {
      grandTotalCalculated = Math.round(grandTotalCalculated * 100) / 100;
      const diffGrand = Math.round((grandTotalCalculated - this.detectedGrandTotal) * 100) / 100;
      if (Math.abs(diffGrand) > 0.01) {
        discrepancies.push({
          type: 'grand_total',
          declared: this.detectedGrandTotal,
          calculated: grandTotalCalculated,
          diff: diffGrand,
          msg: `Totale complessivo scritto sul foglio: € ${this.detectedGrandTotal.toFixed(2)} vs Totale calcolato dalle righe: € ${grandTotalCalculated.toFixed(2)} (Scostamento: ${diffGrand > 0 ? '+' : ''}${diffGrand.toFixed(2)}€)`
        });
      }
    }

    return {
      discrepancies,
      hasDiscrepancies: discrepancies.length > 0,
      checkedMultiplications,
      checkedAdditions,
      grandTotalCalculated
    };
  }

  /**
   * Aggiorna il pannello visivo dell'audit matematico
   */
  updateMathAuditUI() {
    const panel = this.container.querySelector('#math-audit-panel');
    if (!panel) return;

    if (this.extractedItems.length === 0) {
      panel.classList.add('hidden');
      return;
    }

    panel.classList.remove('hidden');
    const audit = this.runMathAudit();

    if (!audit.hasDiscrepancies) {
      panel.innerHTML = `
        <div class="audit-status-banner audit-success">
          <div class="audit-status-icon">✓</div>
          <div class="audit-status-content">
            <h4 class="audit-status-title">Quadratura Matematica Perfetta</h4>
            <p class="audit-status-desc">
              Tutti i calcoli rilevati (moltiplicazioni quantità × prezzi e addizioni dei pesi) sono conformi ed esatti al centesimo.
            </p>
          </div>
        </div>
      `;
    } else {
      panel.innerHTML = `
        <div class="audit-status-banner audit-warning">
          <div class="audit-status-icon">⚠️</div>
          <div class="audit-status-content flex-1">
            <h4 class="audit-status-title">Rilevate ${audit.discrepancies.length} Discrepanze nei Calcoli dell'Appunto</h4>
            <ul class="audit-discrepancies-list">
              ${audit.discrepancies.map(d => `<li>${d.msg}</li>`).join('')}
            </ul>
          </div>
          <button type="button" class="btn btn-sm btn-primary" id="btn-apply-exact-math">
            ✨ Applica Calcoli Esatti
          </button>
        </div>
      `;

      const fixBtn = panel.querySelector('#btn-apply-exact-math');
      if (fixBtn) {
        fixBtn.addEventListener('click', () => this.applyExactMath());
      }
    }
  }

  /**
   * Corregge automaticamente le righe applicando i valori esatti del calcolo aritmetico
   */
  applyExactMath() {
    this.extractedItems.forEach(item => {
      // Se c'erano pesi parziali sommati con discrepanza, adegua la quantità totale
      if (Array.isArray(item.sub_weights) && item.sub_weights.length > 1) {
        const sumW = item.sub_weights.reduce((s, w) => s + (parseFloat(w) || 0), 0);
        item.quantity = Math.round(sumW * 100) / 100;
      }
      // Ricalcola il subtotale esatto
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unitPrice) || 0;
      item.subtotal = Math.round(qty * price * 100) / 100;
      item.declared_row_total = item.subtotal;
    });

    this.detectedGrandTotal = null; // Il totale è ora riallineato al calcolo esatto
    this.renderTableRows();
    this.updateMathAuditUI();
    Toast.success('Tutti i subtotali e i pesi sono stati riallineati con esattezza aritmetica!');
  }

  renderTableRows() {
    const tbody = this.container.querySelector('#review-items-tbody');
    if (!tbody) return;

    const supplier = store.getSupplierById(this.selectedSupplierId);
    const catalog = supplier?.priceList || [];

    tbody.innerHTML = '';

    this.extractedItems.forEach((item, index) => {
      const tr = document.createElement('tr');
      tr.className = 'review-row';

      const hasSubweights = Array.isArray(item.sub_weights) && item.sub_weights.length > 1;
      const subweightsHint = hasSubweights ? `
        <span class="subweights-badge" title="Pesi parziali rilevati">
          ⚖️ Pesi: ${item.sub_weights.join(' + ')} = ${item.quantity}
        </span>
      ` : '';

      const calcHint = item.calculation_expression ? `
        <span class="calc-expression-badge" title="Operazione manoscritta rilevata">
          🔢 ${item.calculation_expression}
        </span>
      ` : '';

      tr.innerHTML = `
        <td>
          <input type="text" class="table-input item-name font-weight-bold" list="catalog-datalist-${index}" value="${item.productName}" data-idx="${index}">
          <datalist id="catalog-datalist-${index}">
            ${catalog.map(c => `<option value="${c.name}">`).join('')}
          </datalist>
          <div class="item-meta-badges">
            ${subweightsHint}
            ${calcHint}
            ${item.notes ? `<small class="item-note-hint">⚠️ ${item.notes}</small>` : ''}
          </div>
        </td>
        <td>
          <input type="text" class="table-input item-qty font-mono" value="${hasSubweights ? item.sub_weights.join(' + ') : item.quantity}" placeholder="Es: 12.4 + 13.1 o 25.5" title="Inserisci peso o calcolo (es: 12.4 + 13.1)" data-idx="${index}">
        </td>
        <td>
          <select class="table-select item-unit" data-idx="${index}">
            <option value="kg" ${item.unit === 'kg' ? 'selected' : ''}>kg</option>
            <option value="pz" ${item.unit === 'pz' ? 'selected' : ''}>pz</option>
            <option value="casse" ${item.unit === 'casse' ? 'selected' : ''}>casse</option>
            <option value="colli" ${item.unit === 'colli' ? 'selected' : ''}>colli</option>
            <option value="lt" ${item.unit === 'lt' ? 'selected' : ''}>lt</option>
          </select>
        </td>
        <td>
          <input type="number" step="0.01" min="0" class="table-input item-price font-mono text-right" value="${(item.unitPrice || 0).toFixed(2)}" data-idx="${index}">
        </td>
        <td class="text-right font-weight-bold font-mono row-subtotal" id="subtotal-cell-${index}">
          € ${(item.subtotal || 0).toFixed(2)}
        </td>
        <td class="text-center">
          <button type="button" class="btn-icon-danger btn-delete-row" data-idx="${index}" title="Elimina riga">✕</button>
        </td>
      `;

      tbody.appendChild(tr);
    });

    this.bindRowInputs();
    this.updateTotalsBar();
  }

  bindRowInputs() {
    const tbody = this.container.querySelector('#review-items-tbody');
    if (!tbody) return;

    // Input Nome Prodotto
    tbody.querySelectorAll('.item-name').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        this.extractedItems[idx].productName = e.target.value;
      });
    });

    // Input Quantità con supporto espressioni matematiche (es: 12.4 + 13.1 = 25.5)
    tbody.querySelectorAll('.item-qty').forEach(inp => {
      const evaluateQty = (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const item = this.extractedItems[idx];
        if (!item) return;

        let raw = (e.target.value || '').trim().replace(/,/g, '.');
        let finalQty = 0;
        let subWeights = [];

        if (raw.includes('+')) {
          const parts = raw.split('+').map(p => parseFloat(p.trim())).filter(n => !isNaN(n));
          if (parts.length > 0) {
            subWeights = parts;
            finalQty = Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100;
            e.target.value = finalQty;
          }
        } else {
          finalQty = parseFloat(raw) || 0;
        }

        item.quantity = finalQty;
        if (subWeights.length > 1) {
          item.sub_weights = subWeights;
        } else if (!raw.includes('+')) {
          item.sub_weights = [];
        }

        item.subtotal = Math.round(finalQty * (item.unitPrice || 0) * 100) / 100;
        this.updateRowSubtotalDisplay(idx);
        this.updateTotalsBar();
        this.updateMathAuditUI();
      };

      inp.addEventListener('change', evaluateQty);
      inp.addEventListener('blur', evaluateQty);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          evaluateQty(e);
          e.target.blur();
        }
      });
      inp.addEventListener('input', (e) => {
        const raw = e.target.value;
        if (!raw.includes('+')) {
          const idx = parseInt(e.target.dataset.idx, 10);
          const item = this.extractedItems[idx];
          if (!item) return;
          const qty = parseFloat(raw.replace(/,/g, '.')) || 0;
          item.quantity = qty;
          item.sub_weights = [];
          item.subtotal = Math.round(qty * (item.unitPrice || 0) * 100) / 100;
          this.updateRowSubtotalDisplay(idx);
          this.updateTotalsBar();
          this.updateMathAuditUI();
        }
      });
    });

    // Select Unità di misura
    tbody.querySelectorAll('.item-unit').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        this.extractedItems[idx].unit = e.target.value;
      });
    });

    // Input Prezzo Unitario con ricalcolo immediato
    tbody.querySelectorAll('.item-price').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const price = parseFloat(e.target.value) || 0;
        this.extractedItems[idx].unitPrice = price;
        this.extractedItems[idx].subtotal = Math.round(this.extractedItems[idx].quantity * price * 100) / 100;
        this.updateRowSubtotalDisplay(idx);
        this.updateTotalsBar();
        this.updateMathAuditUI();
      });
    });

    // Eliminazione riga
    tbody.querySelectorAll('.btn-delete-row').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        this.extractedItems.splice(idx, 1);
        this.renderTableRows();
        this.updateMathAuditUI();
      });
    });
  }

  updateRowSubtotalDisplay(idx) {
    const cell = this.container.querySelector(`#subtotal-cell-${idx}`);
    if (cell && this.extractedItems[idx]) {
      cell.textContent = `€ ${this.extractedItems[idx].subtotal.toFixed(2)}`;
    }
  }

  addNewRow() {
    this.extractedItems.push({
      productName: 'Nuovo Articolo',
      quantity: 1,
      sub_weights: [],
      unit: 'kg',
      unitPrice: 0,
      subtotal: 0,
      declared_row_total: null,
      calculation_expression: '',
      notes: ''
    });
    this.renderTableRows();
    this.updateMathAuditUI();
  }

  updatePricesFromSupplierListino() {
    const supplier = store.getSupplierById(this.selectedSupplierId);
    if (!supplier) return;
    const catalog = supplier.priceList || [];

    this.extractedItems.forEach(item => {
      const match = catalog.find(c => 
        c.name.toLowerCase() === item.productName.toLowerCase() ||
        item.productName.toLowerCase().includes(c.name.toLowerCase())
      );
      if (match) {
        item.unitPrice = match.unitPrice;
        item.unit = match.unit;
        item.subtotal = Math.round(item.quantity * item.unitPrice * 100) / 100;
      }
    });

    this.renderTableRows();
    this.updateMathAuditUI();
  }

  updateTotalsBar() {
    const totalRowsEl = this.container.querySelector('#total-rows-val');
    const totalQtyEl = this.container.querySelector('#total-qty-val');
    const grandTotalEl = this.container.querySelector('#grand-total-val');

    let totalQty = 0;
    let grandTotal = 0;

    this.extractedItems.forEach(item => {
      totalQty += (parseFloat(item.quantity) || 0);
      grandTotal += (parseFloat(item.subtotal) || 0);
    });

    if (totalRowsEl) totalRowsEl.textContent = this.extractedItems.length;
    if (totalQtyEl) totalQtyEl.textContent = totalQty.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (grandTotalEl) grandTotalEl.textContent = `€ ${grandTotal.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /**
   * Convalida e archivia la fornitura nel Vault con vincolo obbligatorio fornitore
   * e genera all'istante la Fattura / Ricevuta PDF
   */
  async confirmAndSaveSupply() {
    const supplierSelect = this.container.querySelector('#scan-supplier-select');
    const customSupplierInput = this.container.querySelector('#scan-custom-supplier-input');
    const customName = customSupplierInput?.value?.trim();
    let supplierId = supplierSelect?.value || null;
    let supplierName = '';

    // Verifica vincolante del Fornitore
    if (customName && customName.length > 0) {
      supplierName = customName;
      // Salva o recupera il fornitore censito
      const existing = store.getSuppliers().find(s => s.name.toLowerCase() === customName.toLowerCase());
      if (existing) {
        supplierId = existing.id;
      } else {
        const newSup = await store.saveSupplier({
          name: customName,
          notes: 'Creato automaticamente da Scansione Rapida',
          priceList: []
        });
        supplierId = newSup.id;
      }
    } else if (supplierId) {
      const sup = store.getSupplierById(supplierId);
      supplierName = sup?.name || '';
    }

    if (!supplierName || supplierName.trim() === '') {
      const group = this.container.querySelector('#supplier-selection-group');
      if (group) group.classList.add('supplier-required-error');
      Toast.error('⚠️ NOME FORNITORE OBBLIGATORIO: Seleziona o inserisci un fornitore per convalidare e generare la fattura!');
      if (customSupplierInput) customSupplierInput.focus();
      return;
    }

    if (this.extractedItems.length === 0) {
      Toast.error('Nessuna voce presente nella fornitura.');
      return;
    }

    const dateInput = this.container.querySelector('#scan-date-input');
    const titleInput = this.container.querySelector('#review-doc-title');
    const notesInput = this.container.querySelector('#review-doc-notes');

    const totalQty = this.extractedItems.reduce((sum, item) => sum + (parseFloat(item.quantity) || 0), 0);
    const grandTotal = this.extractedItems.reduce((sum, item) => sum + (parseFloat(item.subtotal) || 0), 0);

    const docDate = dateInput?.value || this.documentDate;
    const invoiceNumber = `FT-${docDate.replace(/-/g, '')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const supplyData = {
      supplierId,
      supplierName,
      invoiceNumber,
      date: docDate,
      documentTitle: titleInput?.value || `Fornitura ${supplierName} - ${docDate}`,
      items: JSON.parse(JSON.stringify(this.extractedItems)),
      totalQuantity: Math.round(totalQty * 100) / 100,
      totalAmount: Math.round(grandTotal * 100) / 100,
      notes: notesInput?.value || '',
      mathAuditStatus: 'VERIFICATO_CONFORME'
    };

    try {
      const savedSupply = await store.saveSupply(supplyData);
      Toast.success('Fornitura convalidata e salvata con successo nel Vault protetto da AES-256!');

      // MOSTRA IMMEDIATAMENTE LA FATTURA PDF A4 PER STAMPA O SALVATAGGIO
      InvoiceGenerator.showInvoiceModal(savedSupply, () => {
        this.resetScan();
        window.appRouter?.navigate('archive');
      });
    } catch (err) {
      Toast.error(`Errore durante il salvataggio nel vault: ${err.message}`);
    }
  }

  resetScan() {
    this.currentImageBase64 = null;
    this.activePendingScanId = null;
    this.extractedItems = [];
    this.documentTitle = '';
    this.notes = '';
    this.customSupplierName = '';
    this.detectedGrandTotal = null;
    this.render();
  }

  /**
   * Carica un appunto manoscritto di prova con elenchi di pesi, somme e moltiplicazioni
   */
  loadDemoSample() {
    const svgSample = `
      <svg xmlns="http://www.w3.org/2000/svg" width="600" height="750" viewBox="0 0 600 750">
        <rect width="600" height="750" fill="#fcfcf7"/>
        <defs>
          <pattern id="grid" width="25" height="25" patternUnits="userSpaceOnUse">
            <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#e3e8f0" stroke-width="0.8"/>
          </pattern>
        </defs>
        <rect width="600" height="750" fill="url(#grid)"/>
        
        <text x="40" y="60" font-family="'Caveat', cursive, sans-serif" font-size="28" fill="#1e3a8a" font-weight="bold">Bolla scarico Ortofrutta - 21/09</text>
        <line x1="40" y1="70" x2="460" y2="70" stroke="#3b82f6" stroke-width="2"/>
        
        <!-- Riga 1 con pesi parziali e moltiplicazione -->
        <text x="50" y="130" font-family="'Caveat', cursive, sans-serif" font-size="22" fill="#0f172a">Pomodori San Marzano</text>
        <text x="50" y="160" font-family="'Caveat', cursive, sans-serif" font-size="20" fill="#2563eb">Pesi: 12,4 + 13,1 = 25,5 kg x 2,20 € = 56,10 €</text>

        <!-- Riga 2 con moltiplicazione -->
        <text x="50" y="220" font-family="'Caveat', cursive, sans-serif" font-size="22" fill="#0f172a">Patate Gialle Bologna</text>
        <text x="50" y="250" font-family="'Caveat', cursive, sans-serif" font-size="20" fill="#2563eb">50 kg x 0,95 € = 47,50 €</text>

        <!-- Riga 3 con moltiplicazione -->
        <text x="50" y="310" font-family="'Caveat', cursive, sans-serif" font-size="22" fill="#0f172a">Zucchine Scure</text>
        <text x="50" y="340" font-family="'Caveat', cursive, sans-serif" font-size="20" fill="#2563eb">7,8 kg x 1,80 € = 14,04 €</text>

        <!-- Riga 4 casse -->
        <text x="50" y="400" font-family="'Caveat', cursive, sans-serif" font-size="22" fill="#0f172a">Insalata Iceberg</text>
        <text x="50" y="430" font-family="'Caveat', cursive, sans-serif" font-size="20" fill="#2563eb">4 casse x 12,50 € = 50,00 €</text>

        <!-- Riga 5 pesi parziali sommati -->
        <text x="50" y="490" font-family="'Caveat', cursive, sans-serif" font-size="22" fill="#0f172a">Arance Navel</text>
        <text x="50" y="520" font-family="'Caveat', cursive, sans-serif" font-size="20" fill="#2563eb">Pesi: 12,6 + 12,6 = 25,2 kg x 1,60 € = 40,32 €</text>

        <!-- Totale manoscritto -->
        <line x1="40" y1="560" x2="520" y2="560" stroke="#0f172a" stroke-width="1.5"/>
        <text x="50" y="600" font-family="'Caveat', cursive, sans-serif" font-size="26" fill="#166534" font-weight="bold">Totale Generale Merci: € 207,96 (Pesi Totali: 108,5 kg)</text>
      </svg>
    `;

    this.currentImageBase64 = btoa(unescape(encodeURIComponent(svgSample)));
    this.currentMimeType = 'image/svg+xml';

    const imgEl = this.container.querySelector('#scanned-image-preview');
    if (imgEl) imgEl.src = `data:${this.currentMimeType};base64,${this.currentImageBase64}`;

    this.processOCRResult({
      document_title: "Bolla scarico Ortofrutta - 21/09",
      document_date: new Date().toISOString().split('T')[0],
      detected_supplier_name: "Ortofrutta Centrale SpA",
      declared_grand_total: 207.96,
      items: [
        {
          product_name: "Pomodori San Marzano",
          quantity: 25.5,
          sub_weights: [12.4, 13.1],
          unit: "kg",
          unit_price: 2.20,
          declared_row_total: 56.10,
          calculation_expression: "12.4 + 13.1 = 25.5 kg * 2.20€ = 56.10€",
          notes: "cifra 7 e 1 verificate, 2 pesi sommati"
        },
        {
          product_name: "Patate Gialle Bologna",
          quantity: 50.0,
          sub_weights: [25.0, 25.0],
          unit: "kg",
          unit_price: 0.95,
          declared_row_total: 47.50,
          calculation_expression: "50 kg * 0.95€ = 47.50€",
          notes: ""
        },
        {
          product_name: "Zucchine Scure",
          quantity: 7.8,
          sub_weights: [],
          unit: "kg",
          unit_price: 1.80,
          declared_row_total: 14.04,
          calculation_expression: "7.8 kg * 1.80€ = 14.04€",
          notes: "cifra 7 con trattino"
        },
        {
          product_name: "Insalata Iceberg",
          quantity: 4.0,
          sub_weights: [],
          unit: "casse",
          unit_price: 12.50,
          declared_row_total: 50.00,
          calculation_expression: "4 casse * 12.50€ = 50.00€",
          notes: ""
        },
        {
          product_name: "Arance Navel",
          quantity: 25.2,
          sub_weights: [12.6, 12.6],
          unit: "kg",
          unit_price: 1.60,
          declared_row_total: 40.32,
          calculation_expression: "12.6 + 12.6 = 25.2 kg * 1.60€ = 40.32€",
          notes: "2 pesi sommati"
        }
      ],
      math_audit: {
        detected_additions_count: 2,
        detected_multiplications_count: 5,
        notes_on_calculations: "Tutte le moltiplicazioni e somme di pesi risultano esatte al centesimo."
      },
      general_notes: "Grafia corsiva nitida, pesi con virgola e moltiplicazioni confermate."
    });

    Toast.info('Appunto demo con pesi, somme e moltiplicazioni caricato con successo!');
  }
}
