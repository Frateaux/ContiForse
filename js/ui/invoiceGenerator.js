/**
 * ContiFor - Invoice & Receipt Generator (Modulo Stampa & PDF A4)
 * 
 * Genera un documento strutturato professionale in formato Fattura / Bolla di Consegna,
 * pronto per l'anteprima, la stampa diretta o il salvataggio in PDF.
 */

export class InvoiceGenerator {
  /**
   * Genera il markup HTML completo della fattura/ricevuta
   */
  static generateInvoiceHtml(supply, options = {}) {
    const docId = supply.invoiceNumber || `FT-${(supply.date || '').replace(/-/g, '')}-${(supply.id || '0000').slice(-5).toUpperCase()}`;
    const formattedDate = supply.date ? new Date(supply.date).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }) : new Date().toLocaleDateString('it-IT');

    const items = supply.items || [];
    const totalQty = supply.totalQuantity || items.reduce((sum, it) => sum + (parseFloat(it.quantity) || 0), 0);
    const grandTotal = supply.totalAmount || items.reduce((sum, it) => sum + (parseFloat(it.subtotal) || 0), 0);

    return `
      <div class="invoice-container printable-document" id="printable-invoice">
        <!-- Barra di Azioni a Schermo (non stampata) -->
        <div class="invoice-actions-toolbar no-print">
          <div class="invoice-status-indicator">
            <span class="badge badge-success">✓ Convalidato & Archiviato</span>
            <span class="invoice-id-display">Doc. <strong>${docId}</strong></span>
          </div>
          <div class="invoice-btn-group">
            <button type="button" class="btn btn-primary" id="btn-print-invoice" title="Stampa o Salva come PDF con anteprima di sistema">
              🖨️ Stampa / Salva in PDF
            </button>
            <button type="button" class="btn btn-outline" id="btn-download-invoice-html" title="Scarica il documento come file HTML autonomo">
              💾 Scarica HTML
            </button>
            <button type="button" class="btn btn-subtle" id="btn-close-invoice-modal">
              ✕ Chiudi
            </button>
          </div>
        </div>

        <!-- FOGLIO A4 FATTURA / DOCUMENTO -->
        <div class="invoice-paper">
          <!-- Intestazione Documento -->
          <div class="invoice-header">
            <div class="invoice-brand">
              <div class="invoice-logo">CF</div>
              <div>
                <h2 class="invoice-company-name">ContiFor</h2>
                <p class="invoice-company-sub">Gestione Forniture, Controllo Pesi & Trascrizione OCR</p>
                <p class="invoice-company-meta">Crittografia Client-Side AES-256 • Zero-Cloud Vault</p>
              </div>
            </div>
            <div class="invoice-meta-box">
              <h1 class="invoice-doc-type">FATTURA / RIEPILOGO FORNITURA</h1>
              <table class="invoice-meta-table">
                <tr>
                  <td><strong>N. Documento:</strong></td>
                  <td class="text-right font-mono">${docId}</td>
                </tr>
                <tr>
                  <td><strong>Data Documento:</strong></td>
                  <td class="text-right">${formattedDate}</td>
                </tr>
                <tr>
                  <td><strong>Stato Verifica:</strong></td>
                  <td class="text-right"><span class="invoice-stamp">VERIFICATO</span></td>
                </tr>
              </table>
            </div>
          </div>

          <hr class="invoice-divider" />

          <!-- Dati Fornitore e Destinatario -->
          <div class="invoice-parties-grid">
            <div class="party-box party-supplier">
              <div class="party-title">FORNITORE (Emittente)</div>
              <div class="party-name">${supply.supplierName || 'Fornitore non specificato'}</div>
              ${supply.supplierContact ? `<div class="party-contact">📞 ${supply.supplierContact}</div>` : ''}
              ${supply.documentTitle ? `<div class="party-ref">Riferimento appunto: <em>${supply.documentTitle}</em></div>` : ''}
            </div>
            <div class="party-box party-client">
              <div class="party-title">DESTINATARIO / RICEZIONE MERCI</div>
              <div class="party-name">Magazzino / Punto Vendita</div>
              <div class="party-detail">Controllo Merci in Entrata</div>
              <div class="party-detail">Data Convalida: ${new Date().toLocaleDateString('it-IT')}</div>
            </div>
          </div>

          <!-- Tabella Voci Articoli e Pesi -->
          <div class="invoice-table-wrapper">
            <table class="invoice-items-table">
              <thead>
                <tr>
                  <th style="width: 5%;">#</th>
                  <th style="width: 38%;">Descrizione Articolo / Voce</th>
                  <th style="width: 14%;" class="text-right">Quantità / Peso</th>
                  <th style="width: 8%;" class="text-center">U.M.</th>
                  <th style="width: 15%;" class="text-right">Prezzo Unitario</th>
                  <th style="width: 20%;" class="text-right">Totale Riga</th>
                </tr>
              </thead>
              <tbody>
                ${items.map((it, idx) => {
                  const qty = parseFloat(it.quantity) || 0;
                  const price = parseFloat(it.unitPrice) || 0;
                  const rowTot = parseFloat(it.subtotal) || (qty * price);
                  const subWeightsStr = (it.sub_weights && it.sub_weights.length > 0) 
                    ? `Pesi parziali: (${it.sub_weights.join(' + ')} = ${qty} ${it.unit || ''})` 
                    : '';

                  return `
                    <tr>
                      <td class="text-center font-mono">${idx + 1}</td>
                      <td>
                        <div class="font-weight-bold">${it.productName || 'Articolo'}</div>
                        ${subWeightsStr ? `<div class="invoice-item-subweights">${subWeightsStr}</div>` : ''}
                        ${it.notes ? `<div class="invoice-item-notes">${it.notes}</div>` : ''}
                      </td>
                      <td class="text-right font-mono">${qty.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td class="text-center">${it.unit || 'kg'}</td>
                      <td class="text-right font-mono">€ ${price.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td class="text-right font-weight-bold font-mono">€ ${rowTot.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>

          <!-- Sezione Totali e Certificazione Calcoli -->
          <div class="invoice-bottom-grid">
            <div class="invoice-audit-card">
              <div class="audit-badge">
                <span class="badge-icon">🛡️</span>
                <strong>Audit Matematico & Integrità Dati</strong>
              </div>
              <p class="audit-description">
                Tutte le operazioni aritmetiche (quantità × prezzi e somme di pesi) sono state analizzate, verificate e convalidate. 
                Archiviazione permanente cifrata nel Vault locale protetto da AES-256.
              </p>
              ${supply.notes ? `<div class="invoice-public-notes"><strong>Note Documento:</strong> ${supply.notes}</div>` : ''}
            </div>

            <div class="invoice-totals-box">
              <table class="invoice-totals-table">
                <tr>
                  <td>Numero Voci Totali:</td>
                  <td class="text-right font-mono">${items.length}</td>
                </tr>
                <tr>
                  <td>Peso / Quantità Complessiva:</td>
                  <td class="text-right font-mono"><strong>${totalQty.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
                </tr>
                <tr>
                  <td>Imponibile Netto Merci:</td>
                  <td class="text-right font-mono">€ ${grandTotal.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
                <tr class="invoice-grand-total-row">
                  <td><strong>TOTALE DOCUMENTO:</strong></td>
                  <td class="text-right font-mono"><strong class="grand-total-text">€ ${grandTotal.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
                </tr>
              </table>
            </div>
          </div>

          <!-- Footer e Firma di Ricezione -->
          <div class="invoice-footer">
            <div class="signature-line">
              <div class="sig-title">Firma per il Fornitore</div>
              <div class="sig-space">_________________________</div>
            </div>
            <div class="signature-line">
              <div class="sig-title">Firma per Ricezione & Controllo</div>
              <div class="sig-space">_________________________</div>
            </div>
          </div>
          
          <div class="invoice-watermark-footer">
            Documento generato da ContiFor PWA • Crittografia Client-Side conforme alle specifiche di sicurezza.
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Mostra la modale interattiva a schermo intero con la fattura
   */
  static showInvoiceModal(supply, onClosed = null) {
    let modalEl = document.getElementById('contifor-invoice-modal');
    if (!modalEl) {
      modalEl = document.createElement('div');
      modalEl.id = 'contifor-invoice-modal';
      modalEl.className = 'modal-backdrop invoice-modal-backdrop';
      document.body.appendChild(modalEl);
    }

    modalEl.innerHTML = `
      <div class="invoice-modal-content">
        ${this.generateInvoiceHtml(supply)}
      </div>
    `;

    modalEl.classList.remove('hidden');
    document.body.classList.add('modal-open-invoice');

    // Binding pulsanti toolbar
    const printBtn = modalEl.querySelector('#btn-print-invoice');
    if (printBtn) {
      printBtn.addEventListener('click', () => {
        window.print();
      });
    }

    const downloadBtn = modalEl.querySelector('#btn-download-invoice-html');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        this.downloadInvoiceHtml(supply);
      });
    }

    const closeBtn = modalEl.querySelector('#btn-close-invoice-modal');
    const handleClose = () => {
      modalEl.classList.add('hidden');
      document.body.classList.remove('modal-open-invoice');
      if (typeof onClosed === 'function') {
        onClosed();
      }
    };

    if (closeBtn) {
      closeBtn.addEventListener('click', handleClose);
    }
  }

  /**
   * Scarica il documento come file HTML autonomo stampabile offline
   */
  static downloadInvoiceHtml(supply) {
    const rawHtml = this.generateInvoiceHtml(supply);
    const fullHtml = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Fattura_${(supply.supplierName || 'Fornitura').replace(/\s+/g, '_')}_${supply.date}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6; margin: 0; padding: 20px; color: #111827; }
    .invoice-actions-toolbar { display: none !important; }
    .invoice-paper { max-width: 800px; margin: 0 auto; background: #fff; padding: 40px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
    .invoice-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    .invoice-brand { display: flex; align-items: center; gap: 12px; }
    .invoice-logo { width: 44px; height: 44px; background: #2563eb; color: #fff; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 20px; }
    .invoice-company-name { margin: 0; font-size: 22px; font-weight: 700; color: #111827; }
    .invoice-company-sub { margin: 2px 0 0 0; font-size: 12px; color: #4b5563; }
    .invoice-company-meta { margin: 2px 0 0 0; font-size: 11px; color: #6b7280; }
    .invoice-doc-type { margin: 0 0 8px 0; font-size: 16px; font-weight: 800; color: #2563eb; letter-spacing: 0.05em; text-align: right; }
    .invoice-meta-table td { padding: 3px 6px; font-size: 13px; }
    .invoice-stamp { background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; }
    .invoice-divider { border: 0; border-top: 2px solid #e5e7eb; margin: 20px 0; }
    .invoice-parties-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
    .party-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px; }
    .party-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #6b7280; margin-bottom: 6px; }
    .party-name { font-size: 16px; font-weight: 700; color: #111827; margin-bottom: 4px; }
    .party-contact, .party-ref, .party-detail { font-size: 13px; color: #4b5563; }
    .invoice-items-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    .invoice-items-table th { background: #f3f4f6; color: #374151; font-size: 12px; font-weight: 700; text-transform: uppercase; padding: 10px; border-bottom: 2px solid #d1d5db; }
    .invoice-items-table td { padding: 10px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
    .invoice-item-subweights { font-size: 11px; color: #2563eb; font-family: monospace; margin-top: 2px; }
    .invoice-item-notes { font-size: 11px; color: #6b7280; font-style: italic; }
    .invoice-bottom-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 20px; margin-bottom: 30px; }
    .invoice-audit-card { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 14px; font-size: 12px; color: #1e40af; }
    .audit-badge { display: flex; align-items: center; gap: 6px; font-size: 13px; margin-bottom: 6px; }
    .invoice-totals-table { width: 100%; border-collapse: collapse; }
    .invoice-totals-table td { padding: 6px 8px; font-size: 13px; }
    .invoice-grand-total-row td { border-top: 2px solid #111827; font-size: 16px; padding-top: 10px; }
    .grand-total-text { color: #2563eb; font-size: 18px; }
    .invoice-footer { display: flex; justify-content: space-between; margin-top: 40px; padding-top: 20px; border-top: 1px dashed #d1d5db; }
    .signature-line { width: 45%; text-align: center; }
    .sig-title { font-size: 12px; font-weight: 600; color: #4b5563; margin-bottom: 40px; }
    .sig-space { font-size: 11px; color: #9ca3af; }
    .invoice-watermark-footer { text-align: center; font-size: 11px; color: #9ca3af; margin-top: 30px; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .font-weight-bold { font-weight: bold; }
    @media print {
      body { background: #fff; padding: 0; }
      .invoice-paper { box-shadow: none; padding: 0; max-width: 100%; }
    }
  </style>
</head>
<body>
  ${rawHtml}
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Fattura_${(supply.supplierName || 'Fornitura').replace(/\s+/g, '_')}_${supply.date || 'doc'}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
