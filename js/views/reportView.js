/**
 * ContiFor - Report View (Modulo E: Dashboard di Reportistica e Confronto Selettivo Costi)
 * 
 * Filtri multi-select fornitori, metriche aggregate, grafici SVG nativi e tabella comparativa
 */

import { store } from '../store/state.js';
import { ChartEngine } from '../ui/charts.js';

export class ReportView {
  constructor(container) {
    this.container = container;
    this.selectedSupplierIds = new Set();
    this.periodFilter = 'ALL'; // '30D', '90D', 'CURRENT_MONTH', 'YEAR', 'ALL'
    this.initialized = false;
  }

  render() {
    const allSuppliers = store.getSuppliers();
    const allSupplies = store.getSupplies();

    // Di default, all'avvio seleziona tutti i fornitori presenti
    if (!this.initialized && allSuppliers.length > 0) {
      this.selectedSupplierIds = new Set(allSuppliers.map(s => s.id));
      this.initialized = true;
    }

    // Filtraggio per periodo
    const filteredByPeriod = this.filterSuppliesByPeriod(allSupplies);

    // Filtraggio per soli fornitori selezionati
    const targetSupplies = filteredByPeriod.filter(s => this.selectedSupplierIds.has(s.supplierId));

    // Metriche chiave aggregate
    const totalSpent = targetSupplies.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
    const totalDeliveries = targetSupplies.length;
    const avgDeliveryCost = totalDeliveries > 0 ? totalSpent / totalDeliveries : 0;
    const totalQty = targetSupplies.reduce((acc, s) => acc + (s.totalQuantity || 0), 0);

    this.container.innerHTML = `
      <div class="view-header">
        <div>
          <h1 class="view-title">Dashboard & Confronto Fornitori</h1>
          <p class="view-subtitle">Analisi comparativa selettiva dei costi e incidenza sui volumi</p>
        </div>
      </div>

      <!-- Sezione Filtri Selettivi Fornitori (Checkbox Multi-select) -->
      <div class="card selector-filter-card">
        <div class="filter-card-header">
          <div class="filter-card-title-group">
            <h3 class="card-title">Filtro Fornitori a Confronto</h3>
            <p class="card-subtitle">Seleziona o deseleziona i fornitori per isolare il confronto (es. solo A vs B)</p>
          </div>
          <div class="filter-actions-inline">
            <button type="button" id="btn-select-all-sup" class="btn btn-sm btn-subtle">Seleziona Tutti</button>
            <button type="button" id="btn-clear-all-sup" class="btn btn-sm btn-subtle">Deseleziona</button>
          </div>
        </div>

        <div class="supplier-checkbox-chips" id="supplier-chips-container">
          ${allSuppliers.map((s, index) => {
            const isChecked = this.selectedSupplierIds.has(s.id);
            const badgeColor = ChartEngine.getColor(index);
            return `
              <label class="chip-checkbox ${isChecked ? 'active' : ''}">
                <input type="checkbox" class="sup-filter-checkbox" value="${s.id}" ${isChecked ? 'checked' : ''}>
                <span class="chip-color-dot" style="background-color: ${badgeColor};"></span>
                <span class="chip-text">${s.name}</span>
              </label>
            `;
          }).join('')}
          ${allSuppliers.length === 0 ? '<p class="text-subtle">Nessun fornitore registrato nel sistema.</p>' : ''}
        </div>

        <!-- Periodo temporale -->
        <div class="period-select-row mt-3">
          <label class="form-label" for="report-period-select">Periodo di Analisi:</label>
          <select id="report-period-select" class="form-select period-select-input">
            <option value="ALL" ${this.periodFilter === 'ALL' ? 'selected' : ''}>Tutto lo storico</option>
            <option value="CURRENT_MONTH" ${this.periodFilter === 'CURRENT_MONTH' ? 'selected' : ''}>Mese corrente</option>
            <option value="30D" ${this.periodFilter === '30D' ? 'selected' : ''}>Ultimi 30 giorni</option>
            <option value="90D" ${this.periodFilter === '90D' ? 'selected' : ''}>Ultimi 90 giorni</option>
            <option value="YEAR" ${this.periodFilter === 'YEAR' ? 'selected' : ''}>Anno corrente</option>
          </select>
        </div>
      </div>

      <!-- KPI Cards -->
      <div class="kpi-grid">
        <div class="card kpi-card">
          <span class="kpi-label">Spesa Totale Selezionata</span>
          <span class="kpi-value text-primary">€ ${totalSpent.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span class="kpi-subtext">Tra ${this.selectedSupplierIds.size} fornitori inclusi</span>
        </div>

        <div class="card kpi-card">
          <span class="kpi-label">Forniture Effettuate</span>
          <span class="kpi-value">${totalDeliveries}</span>
          <span class="kpi-subtext">Consegne verificate</span>
        </div>

        <div class="card kpi-card">
          <span class="kpi-label">Costo Medio per Fornitura</span>
          <span class="kpi-value">€ ${avgDeliveryCost.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span class="kpi-subtext">Valore medio scontrino/bolla</span>
        </div>

        <div class="card kpi-card">
          <span class="kpi-label">Quantità Totale Movimentata</span>
          <span class="kpi-value">${totalQty.toFixed(1)}</span>
          <span class="kpi-subtext">Unità complessive (kg/pz)</span>
        </div>
      </div>

      <!-- Sezione Grafici Interattivi -->
      <div class="charts-row">
        <!-- Grafico Ciambella Incidenza Percentuale -->
        <div class="card chart-card flex-1">
          <div class="card-header-clean">
            <h3 class="card-title">Ripartizione della Spesa (%)</h3>
            <p class="card-subtitle">Incidenza sul budget dei soli fornitori selezionati</p>
          </div>
          <div id="donut-chart-box" class="chart-content-box"></div>
        </div>

        <!-- Grafico Andamento Mensile -->
        <div class="card chart-card flex-1">
          <div class="card-header-clean">
            <h3 class="card-title">Andamento Mensile per Fornitore</h3>
            <p class="card-subtitle">Confronto dei costi nei vari mesi</p>
          </div>
          <div id="bar-chart-box" class="chart-content-box"></div>
        </div>
      </div>

      <!-- Tabella Comparativa di Dettaglio -->
      <div class="card mt-3">
        <div class="card-header-clean">
          <h3 class="card-title">Tabella Comparativa Fornitori</h3>
          <p class="card-subtitle">Spesa cumulata, numero consegne, costo medio e incidenza percentuale</p>
        </div>
        <div class="table-responsive">
          <table class="items-table" id="comparison-table">
            <thead>
              <tr>
                <th>Fornitore</th>
                <th class="text-right">Forniture</th>
                <th class="text-right">Q.tà Totale</th>
                <th class="text-right">Costo Medio</th>
                <th class="text-right">Spesa Cumulata</th>
                <th class="text-right">Incidenza %</th>
              </tr>
            </thead>
            <tbody id="comparison-tbody">
              <!-- Popolato da renderComparisonTable -->
            </tbody>
          </table>
        </div>
      </div>
    `;

    this.bindEvents();
    this.renderCharts(targetSupplies, allSuppliers, totalSpent);
    this.renderComparisonTable(targetSupplies, allSuppliers, totalSpent);
  }

  filterSuppliesByPeriod(supplies) {
    const now = new Date();
    if (this.periodFilter === 'ALL') return supplies;

    let cutoffDate = new Date(0);

    if (this.periodFilter === '30D') {
      cutoffDate = new Date(now.getTime() - 30 * 86400000);
    } else if (this.periodFilter === '90D') {
      cutoffDate = new Date(now.getTime() - 90 * 86400000);
    } else if (this.periodFilter === 'CURRENT_MONTH') {
      cutoffDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (this.periodFilter === 'YEAR') {
      cutoffDate = new Date(now.getFullYear(), 0, 1);
    }

    const cutoffISO = cutoffDate.toISOString().split('T')[0];
    return supplies.filter(s => s.date >= cutoffISO);
  }

  renderCharts(targetSupplies, allSuppliers, totalSpent) {
    // 1. Ripartizione Donut Chart
    const donutBox = this.container.querySelector('#donut-chart-box');
    if (donutBox) {
      const donutData = [];
      allSuppliers.forEach((s, idx) => {
        if (this.selectedSupplierIds.has(s.id)) {
          const supSupplies = targetSupplies.filter(entry => entry.supplierId === s.id);
          const spent = supSupplies.reduce((sum, entry) => sum + (entry.totalAmount || 0), 0);
          donutData.push({
            label: s.name,
            value: spent,
            color: ChartEngine.getColor(idx)
          });
        }
      });
      ChartEngine.renderDonutChart(donutBox, donutData, 'Totale Selezionato');
    }

    // 2. Bar Chart Andamento Mensile
    const barBox = this.container.querySelector('#bar-chart-box');
    if (barBox) {
      // Calcola gli ultimi 6 mesi
      const months = [];
      const monthKeys = [];
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const label = d.toLocaleDateString('it-IT', { month: 'short' });
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        months.push(label.charAt(0).toUpperCase() + label.slice(1));
        monthKeys.push(key);
      }

      const series = [];
      allSuppliers.forEach((s, idx) => {
        if (this.selectedSupplierIds.has(s.id)) {
          const monthlyTotals = monthKeys.map(mKey => {
            const inMonth = targetSupplies.filter(entry => entry.supplierId === s.id && entry.date?.startsWith(mKey));
            return inMonth.reduce((sum, entry) => sum + (entry.totalAmount || 0), 0);
          });

          series.push({
            supplierId: s.id,
            supplierName: s.name,
            color: ChartEngine.getColor(idx),
            monthlyTotals
          });
        }
      });

      ChartEngine.renderMonthlyBarChart(barBox, months, series);
    }
  }

  renderComparisonTable(targetSupplies, allSuppliers, totalSpent) {
    const tbody = this.container.querySelector('#comparison-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const rowsData = [];
    allSuppliers.forEach((s, idx) => {
      if (this.selectedSupplierIds.has(s.id)) {
        const supSupplies = targetSupplies.filter(entry => entry.supplierId === s.id);
        const count = supSupplies.length;
        const total = supSupplies.reduce((sum, entry) => sum + (entry.totalAmount || 0), 0);
        const qty = supSupplies.reduce((sum, entry) => sum + (entry.totalQuantity || 0), 0);
        const avg = count > 0 ? total / count : 0;
        const percent = totalSpent > 0 ? (total / totalSpent) * 100 : 0;

        rowsData.push({
          supplier: s,
          color: ChartEngine.getColor(idx),
          count,
          total,
          qty,
          avg,
          percent
        });
      }
    });

    // Ordina per spesa totale decrescente
    rowsData.sort((a, b) => b.total - a.total);

    if (rowsData.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-subtle">Nessun dato per i fornitori selezionati.</td></tr>`;
      return;
    }

    rowsData.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="sup-table-cell">
            <span class="color-dot" style="background-color: ${row.color};"></span>
            <strong>${row.supplier.name}</strong>
          </div>
        </td>
        <td class="text-right">${row.count}</td>
        <td class="text-right">${row.qty.toFixed(1)}</td>
        <td class="text-right">€ ${row.avg.toFixed(2)}</td>
        <td class="text-right font-weight-bold">€ ${row.total.toFixed(2)}</td>
        <td class="text-right"><span class="badge ${row.percent > 40 ? 'badge-warning' : 'badge-info'}">${row.percent.toFixed(1)}%</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  bindEvents() {
    // Gestione checkbox fornitore
    const chipsContainer = this.container.querySelector('#supplier-chips-container');
    if (chipsContainer) {
      chipsContainer.addEventListener('change', (e) => {
        if (e.target.classList.contains('sup-filter-checkbox')) {
          const supId = e.target.value;
          if (e.target.checked) {
            this.selectedSupplierIds.add(supId);
          } else {
            this.selectedSupplierIds.delete(supId);
          }
          this.render();
        }
      });
    }

    // Seleziona tutti
    const selectAllBtn = this.container.querySelector('#btn-select-all-sup');
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', () => {
        const suppliers = store.getSuppliers();
        this.selectedSupplierIds = new Set(suppliers.map(s => s.id));
        this.render();
      });
    }

    // Deseleziona tutti
    const clearAllBtn = this.container.querySelector('#btn-clear-all-sup');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        this.selectedSupplierIds.clear();
        this.render();
      });
    }

    // Cambio periodo
    const periodSelect = this.container.querySelector('#report-period-select');
    if (periodSelect) {
      periodSelect.addEventListener('change', (e) => {
        this.periodFilter = e.target.value;
        this.render();
      });
    }
  }
}
