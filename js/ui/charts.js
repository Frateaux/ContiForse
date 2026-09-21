/**
 * ContiFor - Motore di Rendering Grafici SVG Nativo e Interattivo
 * 
 * 100% Offline-ready (nessuna dipendenza CDN o libreria esterna):
 * - Grafico a Barre Raggruppate / Andamento Mensile per Fornitore
 * - Grafico a Ciambella (Donut Chart) con incidenza percentuale e legenda
 * - Supporto dinamico Dark/Light theme e Tooltip touch-friendly
 */

export class ChartEngine {
  // Palette di colori ad alto contrasto distinta per i fornitori
  static PALETTE = [
    '#3b82f6', // Blu primario
    '#10b981', // Smeraldo
    '#f59e0b', // Ambra
    '#ec4899', // Fucsia
    '#8b5cf6', // Viola
    '#06b6d4', // Ciano
    '#f97316', // Arancio
    '#14b8a6', // Teal
    '#6366f1'  // Indaco
  ];

  static getColor(index) {
    return this.PALETTE[index % this.PALETTE.length];
  }

  /**
   * Genera un Grafico a Ciambella (Donut) interattivo in SVG
   * @param {HTMLElement} container - Elemento contenitore
   * @param {Array<{label: string, value: number, color?: string}>} data - Dati
   * @param {string} title - Titolo o etichetta centrale
   */
  static renderDonutChart(container, data, centerLabel = 'Totale') {
    container.innerHTML = '';

    const validData = data.filter(d => d.value > 0);
    const total = validData.reduce((sum, d) => sum + d.value, 0);

    if (total === 0 || validData.length === 0) {
      container.innerHTML = `
        <div class="chart-empty-state">
          <p>Nessuna fornitura registrata per i fornitori selezionati.</p>
        </div>
      `;
      return;
    }

    const size = 320;
    const strokeWidth = 38;
    const radius = (size - strokeWidth) / 2;
    const center = size / 2;
    const circumference = 2 * Math.PI * radius;

    let accumulatedAngle = -90; // Inizia in alto
    let accumulatedOffset = 0;

    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("class", "donut-chart-svg");

    // Gruppo per gli archi
    const arcsGroup = document.createElementNS(svgNs, "g");

    validData.forEach((item, index) => {
      const percentage = (item.value / total);
      const dashArray = `${percentage * circumference} ${circumference}`;
      const color = item.color || this.getColor(index);

      const circle = document.createElementNS(svgNs, "circle");
      circle.setAttribute("cx", center);
      circle.setAttribute("cy", center);
      circle.setAttribute("r", radius);
      circle.setAttribute("fill", "transparent");
      circle.setAttribute("stroke", color);
      circle.setAttribute("stroke-width", strokeWidth);
      circle.setAttribute("stroke-dasharray", dashArray);
      circle.setAttribute("stroke-dashoffset", -accumulatedOffset);
      circle.setAttribute("transform", `rotate(-90 ${center} ${center})`);
      circle.setAttribute("class", "donut-segment");
      circle.setAttribute("data-label", item.label);
      circle.setAttribute("data-value", item.value.toFixed(2));
      circle.setAttribute("data-percent", (percentage * 100).toFixed(1));

      // Tooltip su click / hover touch
      circle.addEventListener('click', () => {
        const textCenterVal = svg.querySelector('.donut-center-value');
        const textCenterSub = svg.querySelector('.donut-center-sub');
        if (textCenterVal) textCenterVal.textContent = `€ ${item.value.toLocaleString('it-IT', { minimumFractionDigits: 2 })}`;
        if (textCenterSub) textCenterSub.textContent = `${item.label} (${(percentage * 100).toFixed(1)}%)`;
      });

      arcsGroup.appendChild(circle);
      accumulatedOffset += percentage * circumference;
    });

    svg.appendChild(arcsGroup);

    // Testo centrale
    const textGroup = document.createElementNS(svgNs, "g");
    textGroup.setAttribute("class", "donut-center-text");

    const labelText = document.createElementNS(svgNs, "text");
    labelText.setAttribute("x", center);
    labelText.setAttribute("y", center - 14);
    labelText.setAttribute("text-anchor", "middle");
    labelText.setAttribute("class", "donut-center-sub");
    labelText.textContent = centerLabel;

    const valueText = document.createElementNS(svgNs, "text");
    valueText.setAttribute("x", center);
    valueText.setAttribute("y", center + 18);
    valueText.setAttribute("text-anchor", "middle");
    valueText.setAttribute("class", "donut-center-value");
    valueText.textContent = `€ ${total.toLocaleString('it-IT', { minimumFractionDigits: 2 })}`;

    textGroup.appendChild(labelText);
    textGroup.appendChild(valueText);
    svg.appendChild(textGroup);

    container.appendChild(svg);

    // Costruzione Legenda interattiva
    const legendContainer = document.createElement('div');
    legendContainer.className = 'chart-legend';

    validData.forEach((item, index) => {
      const percentage = ((item.value / total) * 100).toFixed(1);
      const color = item.color || this.getColor(index);

      const legendItem = document.createElement('div');
      legendItem.className = 'legend-item';
      legendItem.innerHTML = `
        <span class="legend-badge" style="background-color: ${color};"></span>
        <span class="legend-label" title="${item.label}">${item.label}</span>
        <span class="legend-amount">€ ${item.value.toLocaleString('it-IT', { minimumFractionDigits: 2 })}</span>
        <span class="legend-percent">(${percentage}%)</span>
      `;
      legendContainer.appendChild(legendItem);
    });

    container.appendChild(legendContainer);
  }

  /**
   * Genera un Grafico a Barre Andamento Mensile dei costi per Fornitore
   * @param {HTMLElement} container - Contenitore
   * @param {Array<string>} months - Elenco mesi (es. ["Giu", "Lug", "Ago", "Set"])
   * @param {Array<{supplierId: string, supplierName: string, color: string, monthlyTotals: number[]}>} series - Serie dati
   */
  static renderMonthlyBarChart(container, months, series) {
    container.innerHTML = '';

    if (!series || series.length === 0 || !months || months.length === 0) {
      container.innerHTML = `
        <div class="chart-empty-state">
          <p>Nessun dato temporale disponibile per i filtri selezionati.</p>
        </div>
      `;
      return;
    }

    // Calcolo del valore massimo per la scala Y
    let maxVal = 0;
    months.forEach((_, mIdx) => {
      let monthSum = 0;
      series.forEach(s => {
        const val = s.monthlyTotals[mIdx] || 0;
        if (val > maxVal) maxVal = val;
        monthSum += val;
      });
    });

    if (maxVal === 0) maxVal = 100;
    // Arrotondamento superiore per la griglia
    const yGridMax = Math.ceil(maxVal * 1.15 / 50) * 50 || 100;

    const width = 600;
    const height = 300;
    const padLeft = 65;
    const padRight = 20;
    const padTop = 30;
    const padBottom = 45;

    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;

    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("class", "bar-chart-svg");

    // Linee guida orizzontali Y
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const yVal = (yGridMax / steps) * i;
      const yPos = padTop + plotHeight - (yVal / yGridMax) * plotHeight;

      const line = document.createElementNS(svgNs, "line");
      line.setAttribute("x1", padLeft);
      line.setAttribute("y1", yPos);
      line.setAttribute("x2", width - padRight);
      line.setAttribute("y2", yPos);
      line.setAttribute("stroke", "var(--border-subtle, #374151)");
      line.setAttribute("stroke-dasharray", i === 0 ? "none" : "3,3");
      svg.appendChild(line);

      const label = document.createElementNS(svgNs, "text");
      label.setAttribute("x", padLeft - 8);
      label.setAttribute("y", yPos + 4);
      label.setAttribute("text-anchor", "end");
      label.setAttribute("class", "chart-axis-label");
      label.textContent = `€${Math.round(yVal)}`;
      svg.appendChild(label);
    }

    // Barre raggruppate per mese
    const groupWidth = plotWidth / months.length;
    const barWidth = Math.max(8, Math.min(26, (groupWidth * 0.75) / series.length));

    months.forEach((month, mIdx) => {
      const groupCenterX = padLeft + (mIdx + 0.5) * groupWidth;
      const totalGroupWidth = series.length * barWidth + (series.length - 1) * 3;
      const groupStartX = groupCenterX - (totalGroupWidth / 2);

      // Etichetta del mese sull'asse X
      const xLabel = document.createElementNS(svgNs, "text");
      xLabel.setAttribute("x", groupCenterX);
      xLabel.setAttribute("y", height - 12);
      xLabel.setAttribute("text-anchor", "middle");
      xLabel.setAttribute("class", "chart-axis-label month-label");
      xLabel.textContent = month;
      svg.appendChild(xLabel);

      // Barre dei singoli fornitori
      series.forEach((s, sIdx) => {
        const val = s.monthlyTotals[mIdx] || 0;
        const barHeight = (val / yGridMax) * plotHeight;
        const barX = groupStartX + sIdx * (barWidth + 3);
        const barY = padTop + plotHeight - barHeight;

        if (barHeight > 0) {
          const rect = document.createElementNS(svgNs, "rect");
          rect.setAttribute("x", barX);
          rect.setAttribute("y", barY);
          rect.setAttribute("width", barWidth);
          rect.setAttribute("height", Math.max(3, barHeight));
          rect.setAttribute("rx", "3");
          rect.setAttribute("fill", s.color);
          rect.setAttribute("class", "bar-rect");
          rect.setAttribute("data-supplier", s.supplierName);
          rect.setAttribute("data-month", month);
          rect.setAttribute("data-val", val.toFixed(2));

          // Titolo SVG per tooltip nativo rapido
          const titleEl = document.createElementNS(svgNs, "title");
          titleEl.textContent = `${s.supplierName} (${month}): € ${val.toLocaleString('it-IT', { minimumFractionDigits: 2 })}`;
          rect.appendChild(titleEl);

          svg.appendChild(rect);
        }
      });
    });

    container.appendChild(svg);

    // Legenda serie
    const legendContainer = document.createElement('div');
    legendContainer.className = 'chart-series-legend';
    series.forEach(s => {
      const totalSerie = s.monthlyTotals.reduce((a, b) => a + b, 0);
      const item = document.createElement('div');
      item.className = 'series-legend-item';
      item.innerHTML = `
        <span class="series-badge" style="background-color: ${s.color};"></span>
        <span class="series-name">${s.supplierName}</span>
        <span class="series-val">€ ${totalSerie.toLocaleString('it-IT', { minimumFractionDigits: 2 })}</span>
      `;
      legendContainer.appendChild(item);
    });

    container.appendChild(legendContainer);
  }
}
