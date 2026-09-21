/**
 * ContiFor - Archive View (Modulo D: Archivio Storico Forniture)
 * 
 * Registro cronologico, filtri avanzati, scheda di dettaglio ed export CSV per Excel
 */

import { store } from '../store/state.js';
import { Toast } from '../ui/toast.js';
import { InvoiceGenerator } from '../ui/invoiceGenerator.js';

export class ArchiveView {
  constructor(container) {
    this.container = container;
    this.filterSupplier = 'ALL';
    this.filterStartDate = '';
    this.filterEndDate = '';
    this.filterSearchText = '';
    this.selectedSupplyForDetail = null;
  }

  render() {
    const suppliers = store.getSuppliers();
    const allSupplies = store.getSupplies();
    const filteredSupplies = this.getFilteredSupplies(allSupplies);

    const totalSpent = filteredSupplies.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
    const totalDeliveries = filteredSupplies.length;

    this.container.innerHTML = `
      <div class="view-header">
        <div>
          <h1 class="view-title">Archivio Storico Forniture</h1>
          <p class="view-subtitle">Consulta, filtra ed esporta tutte le forniture confermate</p>
        </div>
        <div class="view-actions">
          <button type="button" id="btn-export-csv" class="btn btn-secondary btn-sm" title="Esporta le forniture filtrate in CSV per Excel">
            📥 Esporta CSV
          </button>
        </div>
      </div>

      <!-- Filtri di ricerca rapidi -->
      <div class="card filter-card">
        <div class="filter-grid">
          <div class="form-group">
            <label class="form-label" for="filter-supplier">Fornitore</label>
            <select id="filter-supplier" class="form-select">
              <option value="ALL">Tutti i Fornitori</option>
              ${suppliers.map(s => `
                <option value="${s.id}" ${this.filterSupplier === s.id ? 'selected' : ''}>${s.name}</option>
              `).join('')}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="filter-start-date">Dal</label>
            <input type="date" id="filter-start-date" class="form-input" value="${this.filterStartDate}">
          </div>

          <div class="form-group">
            <label class="form-label" for="filter-end-date">Al</label>
            <input type="date" id="filter-end-date" class="form-input" value="${this.filterEndDate}">
          </div>

          <div class="form-group">
            <label class="form-label" for="filter-search-text">Cerca nel testo</label>
            <input type="text" id="filter-search-text" class="form-input" placeholder="Cerca prodotto, nota o doc..." value="${this.filterSearchText}">
          </div>
        </div>

        <div class="filter-footer">
          <div class="filter-stats">
            <span>Forniture: <strong>${totalDeliveries}</strong></span>
            <span>Totale Selezionato: <strong class="text-primary">€ ${totalSpent.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
          </div>
          <button type="button" id="btn-reset-filters" class="btn btn-subtle btn-sm">Reimposta Filtri</button>
        </div>
      </div>

      <!-- Elenco Forniture -->
      <div class="supplies-list-container" id="supplies-list">
        ${filteredSupplies.length === 0 ? `
          <div class="empty-state card">
            <div class="empty-state-icon">📋</div>
            <h3>Nessuna fornitura trovata</h3>
            <p>Nessun record corrisponde ai filtri selezionati o non hai ancora registrato forniture.</p>
          </div>
        ` : `
          <div class="supplies-grid">
            ${filteredSupplies.map(supply => this.renderSupplyCard(supply)).join('')}
          </div>
        `}
      </div>

      <!-- Modal Dettaglio Fornitura -->
      <div id="supply-detail-modal" class="modal-backdrop hidden">
        <div class="modal-content card modal-lg">
          <div class="modal-header">
            <h3 class="modal-title" id="modal-supply-title">Dettaglio Fornitura</h3>
            <button type="button" class="btn-close-modal" id="btn-close-detail">✕</button>
          </div>
          <div class="modal-body" id="modal-supply-body">
            <!-- Popolato dinamicamente da showDetailModal -->
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  renderSupplyCard(supply) {
    const formattedDate = new Date(supply.date).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });

    const itemsCount = supply.items?.length || 0;

    return `
      <div class="card supply-card animate-fade-in" data-id="${supply.id}">
        <div class="supply-card-header">
          <div>
            <span class="supply-supplier-badge">${supply.supplierName}</span>
            <h3 class="supply-card-title">${supply.documentTitle || 'Fornitura'}</h3>
          </div>
          <div class="supply-card-amount">
            € ${(supply.totalAmount || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        <div class="supply-card-meta">
          <span>📅 ${formattedDate}</span>
          <span>📦 ${itemsCount} voci (${(supply.totalQuantity || 0).toFixed(1)} u.m.)</span>
        </div>

        ${supply.notes ? `<p class="supply-card-notes">📝 ${supply.notes}</p>` : ''}

        <div class="supply-card-actions">
          <button type="button" class="btn btn-sm btn-primary btn-print-supply-invoice" data-id="${supply.id}" title="Genera e stampa la fattura PDF di questa fornitura">
            📄 Fattura PDF
          </button>
          <button type="button" class="btn btn-sm btn-outline btn-view-detail" data-id="${supply.id}">
            🔍 Dettaglio & Pesi
          </button>
          <button type="button" class="btn btn-sm btn-icon-danger btn-delete-supply" data-id="${supply.id}" title="Elimina fornitura">
            🗑️
          </button>
        </div>
      </div>
    `;
  }

  getFilteredSupplies(supplies) {
    return supplies.filter(s => {
      // Filtro fornitore
      if (this.filterSupplier !== 'ALL' && s.supplierId !== this.filterSupplier) {
        return false;
      }

      // Filtro data inizio
      if (this.filterStartDate && s.date < this.filterStartDate) {
        return false;
      }

      // Filtro data fine
      if (this.filterEndDate && s.date > this.filterEndDate) {
        return false;
      }

      // Filtro testo libero
      if (this.filterSearchText && this.filterSearchText.trim() !== '') {
        const query = this.filterSearchText.toLowerCase();
        const matchesTitle = s.documentTitle?.toLowerCase().includes(query);
        const matchesSupplier = s.supplierName?.toLowerCase().includes(query);
        const matchesNotes = s.notes?.toLowerCase().includes(query);
        const matchesItems = s.items?.some(i => i.productName.toLowerCase().includes(query));

        if (!matchesTitle && !matchesSupplier && !matchesNotes && !matchesItems) {
          return false;
        }
      }

      return true;
    });
  }

  bindEvents() {
    const supSelect = this.container.querySelector('#filter-supplier');
    if (supSelect) {
      supSelect.addEventListener('change', (e) => {
        this.filterSupplier = e.target.value;
        this.render();
      });
    }

    const startDateInput = this.container.querySelector('#filter-start-date');
    if (startDateInput) {
      startDateInput.addEventListener('change', (e) => {
        this.filterStartDate = e.target.value;
        this.render();
      });
    }

    const endDateInput = this.container.querySelector('#filter-end-date');
    if (endDateInput) {
      endDateInput.addEventListener('change', (e) => {
        this.filterEndDate = e.target.value;
        this.render();
      });
    }

    const searchInput = this.container.querySelector('#filter-search-text');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filterSearchText = e.target.value;
        this.render();
      });
    }

    const resetBtn = this.container.querySelector('#btn-reset-filters');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.filterSupplier = 'ALL';
        this.filterStartDate = '';
        this.filterEndDate = '';
        this.filterSearchText = '';
        this.render();
      });
    }

    const exportCsvBtn = this.container.querySelector('#btn-export-csv');
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', () => this.exportFilteredToCSV());
    }

    // Click delegato sulle card per Dettaglio, Fattura ed Eliminazione
    const listContainer = this.container.querySelector('#supplies-list');
    if (listContainer) {
      listContainer.addEventListener('click', (e) => {
        const invoiceBtn = e.target.closest('.btn-print-supply-invoice');
        if (invoiceBtn) {
          const id = invoiceBtn.dataset.id;
          const supply = store.getSupplyById(id);
          if (supply) {
            InvoiceGenerator.showInvoiceModal(supply);
          }
          return;
        }

        const detailBtn = e.target.closest('.btn-view-detail');
        if (detailBtn) {
          const id = detailBtn.dataset.id;
          this.showDetailModal(id);
          return;
        }

        const deleteBtn = e.target.closest('.btn-delete-supply');
        if (deleteBtn) {
          const id = deleteBtn.dataset.id;
          this.handleDeleteSupply(id);
          return;
        }
      });
    }

    const closeDetailBtn = this.container.querySelector('#btn-close-detail');
    if (closeDetailBtn) {
      closeDetailBtn.addEventListener('click', () => {
        const modal = this.container.querySelector('#supply-detail-modal');
        if (modal) modal.classList.add('hidden');
      });
    }
  }

  showDetailModal(supplyId) {
    const supply = store.getSupplyById(supplyId);
    if (!supply) return;

    const modal = this.container.querySelector('#supply-detail-modal');
    const modalTitle = this.container.querySelector('#modal-supply-title');
    const modalBody = this.container.querySelector('#modal-supply-body');

    modalTitle.textContent = `${supply.documentTitle || 'Fornitura'} - ${supply.supplierName}`;

    modalBody.innerHTML = `
      <div class="modal-info-summary">
        <div><strong>Data:</strong> ${supply.date}</div>
        <div><strong>Fornitore:</strong> ${supply.supplierName}</div>
        <div><strong>Totale Quantità:</strong> ${(supply.totalQuantity || 0).toFixed(2)}</div>
        <div class="text-primary font-weight-bold"><strong>Totale Fornitura:</strong> € ${(supply.totalAmount || 0).toFixed(2)}</div>
      </div>

      ${supply.notes ? `<div class="modal-notes"><strong>Note:</strong> ${supply.notes}</div>` : ''}

      <div class="table-responsive mt-3">
        <table class="items-table">
          <thead>
            <tr>
              <th>Prodotto</th>
              <th class="text-right">Quantità / Peso</th>
              <th>U.M.</th>
              <th class="text-right">Prezzo Unit.</th>
              <th class="text-right">Subtotale</th>
              <th>Note/Origine</th>
            </tr>
          </thead>
          <tbody>
            ${(supply.items || []).map(item => `
              <tr>
                <td class="font-weight-bold">${item.productName}</td>
                <td class="text-right">${item.quantity}</td>
                <td>${item.unit}</td>
                <td class="text-right">€ ${(item.unitPrice || 0).toFixed(2)}</td>
                <td class="text-right font-weight-bold">€ ${(item.subtotal || 0).toFixed(2)}</td>
                <td><small class="text-subtle">${item.notes || '-'}</small></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="modal-actions-bar mt-4 d-flex justify-between">
        <button type="button" class="btn btn-secondary" id="btn-modal-close-bottom">
          Chiudi
        </button>
        <button type="button" class="btn btn-primary" id="btn-modal-print-invoice" data-id="${supply.id}">
          🖨️ Stampa Fattura / Salva PDF A4
        </button>
      </div>
    `;

    const printInvoiceBtn = modalBody.querySelector('#btn-modal-print-invoice');
    if (printInvoiceBtn) {
      printInvoiceBtn.addEventListener('click', () => {
        InvoiceGenerator.showInvoiceModal(supply);
      });
    }

    const closeBottomBtn = modalBody.querySelector('#btn-modal-close-bottom');
    if (closeBottomBtn) {
      closeBottomBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
      });
    }

    modal.classList.remove('hidden');
  }

  async handleDeleteSupply(supplyId) {
    const supply = store.getSupplyById(supplyId);
    if (!supply) return;

    if (confirm(`Sei sicuro di voler eliminare la fornitura "${supply.documentTitle}" di ${supply.supplierName} (€ ${supply.totalAmount.toFixed(2)})?`)) {
      await store.deleteSupply(supplyId);
      Toast.success('Fornitura eliminata dal Vault.');
      this.render();
    }
  }

  /**
   * Genera ed esporta un file CSV compatibile con Microsoft Excel (BOM UTF-8 e separatore punto e virgola)
   */
  exportFilteredToCSV() {
    const allSupplies = store.getSupplies();
    const filtered = this.getFilteredSupplies(allSupplies);

    if (filtered.length === 0) {
      Toast.warning('Nessuna fornitura da esportare con i filtri attuali.');
      return;
    }

    // Intestazione CSV
    const headers = [
      'ID Fornitura',
      'Data Consegna',
      'Fornitore',
      'Riferimento Documento',
      'Prodotto',
      'Quantita',
      'Unita Misura',
      'Prezzo Unitario Euro',
      'Subtotale Riga Euro',
      'Totale Fornitura Euro',
      'Note Articolo',
      'Note Fornitura'
    ];

    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '';
      const text = String(str).replace(/"/g, '""');
      return `"${text}"`;
    };

    const rows = [];
    rows.push(headers.join(';'));

    filtered.forEach(sup => {
      sup.items.forEach(item => {
        const row = [
          escapeCsv(sup.id),
          escapeCsv(sup.date),
          escapeCsv(sup.supplierName),
          escapeCsv(sup.documentTitle),
          escapeCsv(item.productName),
          escapeCsv(item.quantity.toString().replace('.', ',')),
          escapeCsv(item.unit),
          escapeCsv(item.unitPrice.toFixed(2).replace('.', ',')),
          escapeCsv(item.subtotal.toFixed(2).replace('.', ',')),
          escapeCsv(sup.totalAmount.toFixed(2).replace('.', ',')),
          escapeCsv(item.notes || ''),
          escapeCsv(sup.notes || '')
        ];
        rows.push(row.join(';'));
      });
    });

    const csvContent = '\uFEFF' + rows.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    link.setAttribute('href', url);
    link.setAttribute('download', `contifor_storico_forniture_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    Toast.success('File CSV esportato con successo!');
  }
}
