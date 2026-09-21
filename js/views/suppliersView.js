/**
 * ContiFor - Suppliers View (Modulo A: Anagrafica Fornitori e Listini)
 * 
 * Gestione anagrafiche, listini prezzi personalizzati, duplicazione e aggiornamento rapido
 */

import { store } from '../store/state.js';
import { Toast } from '../ui/toast.js';

export class SuppliersView {
  constructor(container) {
    this.container = container;
    this.expandedSupplierId = null;
    this.editingSupplier = null;
  }

  render() {
    const suppliers = store.getSuppliers();

    this.container.innerHTML = `
      <div class="view-header">
        <div>
          <h1 class="view-title">Anagrafica Fornitori & Listini</h1>
          <p class="view-subtitle">Gestisci fornitori, prodotti e prezzi unitari concordati</p>
        </div>
        <div class="view-actions">
          <button type="button" id="btn-new-supplier" class="btn btn-primary btn-sm">
            ➕ Nuovo Fornitore
          </button>
        </div>
      </div>

      <!-- Elenco Fornitori -->
      <div class="suppliers-list">
        ${suppliers.length === 0 ? `
          <div class="card empty-state">
            <div class="empty-state-icon">🏢</div>
            <h3>Nessun fornitore registrato</h3>
            <p>Aggiungi il tuo primo fornitore con il relativo listino prezzi per iniziare.</p>
            <button type="button" id="btn-empty-new-supplier" class="btn btn-primary mt-3">
              Crea Fornitore
            </button>
          </div>
        ` : `
          <div class="suppliers-grid">
            ${suppliers.map(s => this.renderSupplierCard(s)).join('')}
          </div>
        `}
      </div>

      <!-- Modal Crea / Modifica Fornitore -->
      <div id="supplier-modal" class="modal-backdrop hidden">
        <div class="modal-content card modal-lg">
          <div class="modal-header">
            <h3 class="modal-title" id="supplier-modal-title">Nuovo Fornitore</h3>
            <button type="button" class="btn-close-modal" id="btn-close-supplier-modal">✕</button>
          </div>
          <form id="supplier-form">
            <div class="modal-body">
              <input type="hidden" id="modal-sup-id" value="">
              
              <div class="form-group">
                <label class="form-label" for="modal-sup-name">Ragione Sociale / Nome Fornitore *</label>
                <input type="text" id="modal-sup-name" class="form-input" required placeholder="Es. Ortofrutta Centrale SpA">
              </div>

              <div class="form-row">
                <div class="form-group flex-1">
                  <label class="form-label" for="modal-sup-contact">Referente / Telefono / Email</label>
                  <input type="text" id="modal-sup-contact" class="form-input" placeholder="Es. Mario Rossi - 335 1234567">
                </div>
                <div class="form-group flex-1">
                  <label class="form-label" for="modal-sup-notes">Note di consegna / orari</label>
                  <input type="text" id="modal-sup-notes" class="form-input" placeholder="Es. Consegna prima delle 07:00">
                </div>
              </div>

              <hr class="divider">

              <div class="pricelist-editor-header">
                <div>
                  <h4 class="section-title">Listino Prezzi Prodotti</h4>
                  <p class="section-subtitle">Configura i prodotti e i prezzi concordati in Euro (€)</p>
                </div>
                <button type="button" id="btn-modal-add-product" class="btn btn-sm btn-outline">
                  ➕ Aggiungi Prodotto
                </button>
              </div>

              <div class="table-responsive">
                <table class="items-table">
                  <thead>
                    <tr>
                      <th style="width: 45%;">Nome Prodotto</th>
                      <th style="width: 22%;">U.M.</th>
                      <th style="width: 23%;">Prezzo (€)</th>
                      <th style="width: 10%;"></th>
                    </tr>
                  </thead>
                  <tbody id="modal-pricelist-tbody">
                    <!-- Popolato dinamicamente -->
                  </tbody>
                </table>
              </div>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="btn-modal-cancel">Annulla</button>
              <button type="submit" class="btn btn-primary">Salva nel Vault</button>
            </div>
          </form>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  renderSupplierCard(supplier) {
    const productsCount = supplier.priceList?.length || 0;
    const isExpanded = this.expandedSupplierId === supplier.id;

    return `
      <div class="card supplier-card" data-id="${supplier.id}">
        <div class="supplier-card-header">
          <div>
            <h3 class="supplier-name">${supplier.name}</h3>
            ${supplier.contact ? `<p class="supplier-contact">📞 ${supplier.contact}</p>` : ''}
            ${supplier.notes ? `<p class="supplier-notes">📝 ${supplier.notes}</p>` : ''}
          </div>
          <div class="supplier-badge">
            ${productsCount} prodotti a listino
          </div>
        </div>

        <!-- Azioni rapide fornitore -->
        <div class="supplier-actions">
          <button type="button" class="btn btn-sm btn-outline btn-toggle-pricelist" data-id="${supplier.id}">
            ${isExpanded ? '▲ Nascondi Listino' : '▼ Visualizza / Modifica Prezzi'}
          </button>
          <button type="button" class="btn btn-sm btn-subtle btn-duplicate-supplier" data-id="${supplier.id}" title="Duplica fornitore e listino">
            📋 Duplica
          </button>
          <button type="button" class="btn btn-sm btn-subtle btn-edit-supplier" data-id="${supplier.id}">
            ✏️ Modifica
          </button>
          <button type="button" class="btn btn-sm btn-icon-danger btn-delete-supplier" data-id="${supplier.id}" title="Elimina fornitore">
            🗑️
          </button>
        </div>

        <!-- Sezione Listino Espansa -->
        <div class="supplier-pricelist-section ${isExpanded ? '' : 'hidden'}" id="pricelist-section-${supplier.id}">
          <div class="pricelist-quick-bar">
            <span class="text-subtle">Modifica rapida prezzi unitari: i cambiamenti si salvano all'uscita dal campo.</span>
          </div>

          <div class="table-responsive">
            <table class="items-table">
              <thead>
                <tr>
                  <th>Prodotto</th>
                  <th>U.M.</th>
                  <th style="width: 140px;">Prezzo Unitario (€)</th>
                </tr>
              </thead>
              <tbody>
                ${productsCount === 0 ? `
                  <tr><td colspan="3" class="text-center text-subtle">Nessun prodotto in questo listino. Clicca 'Modifica' per aggiungerne.</td></tr>
                ` : (supplier.priceList || []).map(prod => `
                  <tr>
                    <td class="font-weight-bold">${prod.name}</td>
                    <td><span class="badge">${prod.unit}</span></td>
                    <td>
                      <div class="input-with-symbol">
                        <span class="symbol">€</span>
                        <input type="number" step="0.01" min="0" 
                               class="table-input quick-price-input" 
                               value="${prod.unitPrice.toFixed(2)}"
                               data-sup-id="${supplier.id}"
                               data-prod-id="${prod.id}">
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    const newBtn = this.container.querySelector('#btn-new-supplier');
    if (newBtn) newBtn.addEventListener('click', () => this.openSupplierModal());

    const emptyNewBtn = this.container.querySelector('#btn-empty-new-supplier');
    if (emptyNewBtn) emptyNewBtn.addEventListener('click', () => this.openSupplierModal());

    // Eventi delegati sulla lista fornitori
    const listContainer = this.container.querySelector('.suppliers-list');
    if (listContainer) {
      listContainer.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest('.btn-toggle-pricelist');
        if (toggleBtn) {
          const id = toggleBtn.dataset.id;
          this.expandedSupplierId = this.expandedSupplierId === id ? null : id;
          this.render();
          return;
        }

        const editBtn = e.target.closest('.btn-edit-supplier');
        if (editBtn) {
          const id = editBtn.dataset.id;
          this.openSupplierModal(id);
          return;
        }

        const duplicateBtn = e.target.closest('.btn-duplicate-supplier');
        if (duplicateBtn) {
          const id = duplicateBtn.dataset.id;
          this.handleDuplicateSupplier(id);
          return;
        }

        const deleteBtn = e.target.closest('.btn-delete-supplier');
        if (deleteBtn) {
          const id = deleteBtn.dataset.id;
          this.handleDeleteSupplier(id);
          return;
        }
      });

      // Quick price edit change event
      listContainer.addEventListener('change', async (e) => {
        if (e.target.classList.contains('quick-price-input')) {
          const supId = e.target.dataset.supId;
          const prodId = e.target.dataset.prodId;
          const newPrice = parseFloat(e.target.value) || 0;

          const supplier = store.getSupplierById(supId);
          if (supplier) {
            const prod = supplier.priceList.find(p => p.id === prodId);
            if (prod) {
              prod.unitPrice = newPrice;
              await store.saveSupplier(supplier);
              Toast.success(`Prezzo di ${prod.name} aggiornato a € ${newPrice.toFixed(2)}`);
            }
          }
        }
      });
    }

    // Modal Fornitore
    const closeBtn = this.container.querySelector('#btn-close-supplier-modal');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeSupplierModal());

    const cancelBtn = this.container.querySelector('#btn-modal-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeSupplierModal());

    const addProdBtn = this.container.querySelector('#btn-modal-add-product');
    if (addProdBtn) addProdBtn.addEventListener('click', () => this.addModalProductRow());

    const form = this.container.querySelector('#supplier-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleSaveSupplierModal();
      });
    }
  }

  openSupplierModal(supplierId = null) {
    const modal = this.container.querySelector('#supplier-modal');
    const title = this.container.querySelector('#supplier-modal-title');
    const idInput = this.container.querySelector('#modal-sup-id');
    const nameInput = this.container.querySelector('#modal-sup-name');
    const contactInput = this.container.querySelector('#modal-sup-contact');
    const notesInput = this.container.querySelector('#modal-sup-notes');
    const tbody = this.container.querySelector('#modal-pricelist-tbody');

    tbody.innerHTML = '';

    if (supplierId) {
      const supplier = store.getSupplierById(supplierId);
      if (!supplier) return;
      this.editingSupplier = JSON.parse(JSON.stringify(supplier));
      title.textContent = `Modifica Fornitore: ${supplier.name}`;
      idInput.value = supplier.id;
      nameInput.value = supplier.name;
      contactInput.value = supplier.contact || '';
      notesInput.value = supplier.notes || '';

      (supplier.priceList || []).forEach(prod => {
        this.addModalProductRow(prod.name, prod.unit, prod.unitPrice, prod.id);
      });
    } else {
      this.editingSupplier = null;
      title.textContent = 'Nuovo Fornitore';
      idInput.value = '';
      nameInput.value = '';
      contactInput.value = '';
      notesInput.value = '';
      // Due righe predefinite
      this.addModalProductRow('', 'kg', 0);
      this.addModalProductRow('', 'pz', 0);
    }

    modal.classList.remove('hidden');
    nameInput.focus();
  }

  closeSupplierModal() {
    const modal = this.container.querySelector('#supplier-modal');
    if (modal) modal.classList.add('hidden');
  }

  addModalProductRow(name = '', unit = 'kg', price = 0, id = null) {
    const tbody = this.container.querySelector('#modal-pricelist-tbody');
    if (!tbody) return;

    const tr = document.createElement('tr');
    tr.className = 'modal-product-row';
    tr.dataset.prodId = id || ('prod_' + Math.random().toString(36).substring(2, 9));

    tr.innerHTML = `
      <td>
        <input type="text" class="table-input prod-name" placeholder="Es. Mele Golden" value="${name}" required>
      </td>
      <td>
        <select class="table-select prod-unit">
          <option value="kg" ${unit === 'kg' ? 'selected' : ''}>kg</option>
          <option value="pz" ${unit === 'pz' ? 'selected' : ''}>pz</option>
          <option value="casse" ${unit === 'casse' ? 'selected' : ''}>casse</option>
          <option value="colli" ${unit === 'colli' ? 'selected' : ''}>colli</option>
          <option value="lt" ${unit === 'lt' ? 'selected' : ''}>lt</option>
        </select>
      </td>
      <td>
        <div class="input-with-symbol">
          <span class="symbol">€</span>
          <input type="number" step="0.01" min="0" class="table-input prod-price" value="${price}" required>
        </div>
      </td>
      <td class="text-center">
        <button type="button" class="btn-icon-danger btn-modal-del-row" title="Rimuovi prodotto">🗑️</button>
      </td>
    `;

    tr.querySelector('.btn-modal-del-row').addEventListener('click', () => {
      tr.remove();
    });

    tbody.appendChild(tr);
  }

  async handleSaveSupplierModal() {
    const idInput = this.container.querySelector('#modal-sup-id');
    const nameInput = this.container.querySelector('#modal-sup-name');
    const contactInput = this.container.querySelector('#modal-sup-contact');
    const notesInput = this.container.querySelector('#modal-sup-notes');
    const rows = this.container.querySelectorAll('.modal-product-row');

    const priceList = [];
    rows.forEach(r => {
      const name = r.querySelector('.prod-name').value.trim();
      const unit = r.querySelector('.prod-unit').value;
      const price = parseFloat(r.querySelector('.prod-price').value) || 0;
      const prodId = r.dataset.prodId;

      if (name) {
        priceList.push({
          id: prodId,
          name,
          unit,
          unitPrice: price
        });
      }
    });

    const supplierData = {
      id: idInput.value || null,
      name: nameInput.value.trim(),
      contact: contactInput.value.trim(),
      notes: notesInput.value.trim(),
      priceList
    };

    try {
      await store.saveSupplier(supplierData);
      Toast.success('Fornitore e listino salvati con successo nel Vault.');
      this.closeSupplierModal();
      this.render();
    } catch (err) {
      Toast.error(`Errore salvataggio fornitore: ${err.message}`);
    }
  }

  async handleDuplicateSupplier(supplierId) {
    const source = store.getSupplierById(supplierId);
    if (!source) return;

    const newName = prompt(`Inserisci il nome per il fornitore duplicato:`, `${source.name} (Copia)`);
    if (!newName) return;

    try {
      await store.duplicateSupplierPriceList(supplierId, newName);
      Toast.success(`Fornitore e listino duplicati come "${newName}".`);
      this.render();
    } catch (err) {
      Toast.error(`Errore duplicazione: ${err.message}`);
    }
  }

  async handleDeleteSupplier(supplierId) {
    const supplier = store.getSupplierById(supplierId);
    if (!supplier) return;

    if (confirm(`Eliminare il fornitore "${supplier.name}" e il relativo listino prezzi?`)) {
      await store.deleteSupplier(supplierId);
      Toast.success('Fornitore eliminato dal Vault.');
      this.render();
    }
  }
}
