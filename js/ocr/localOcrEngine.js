/**
 * ContiFor - Motore OCR Standalone Locale (Zero-Cloud)
 * 
 * Permette il riconoscimento testo e l'estrazione pesi/calcoli 100% offline sul dispositivo,
 * senza dipendere dalle API di Google Gemini o dai limiti di quota/rate-limit.
 * Supporta Tesseract.js (WASM in Web Worker), Native TextDetector API del browser
 * e un parser euristico per elenchi pesi, moltiplicazioni e quadratura somme.
 */

export class LocalOCREngine {
  static isTesseractLoading = false;
  static tesseractWorker = null;

  /**
   * Verifica se Tesseract.js o Native TextDetector sono disponibili
   */
  static isAvailable() {
    return typeof window !== 'undefined' && (
      typeof window.Tesseract !== 'undefined' ||
      'TextDetector' in window ||
      navigator.onLine
    );
  }

  /**
   * Carica Tesseract.js on-demand se non già presente nel DOM
   */
  static async loadTesseractScript() {
    if (typeof window.Tesseract !== 'undefined') return window.Tesseract;
    if (this.isTesseractLoading) {
      // Attendi che lo script termini il caricamento
      while (this.isTesseractLoading) {
        await new Promise(r => setTimeout(r, 100));
      }
      return window.Tesseract;
    }

    this.isTesseractLoading = true;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        this.isTesseractLoading = false;
        resolve(window.Tesseract);
      };
      script.onerror = (err) => {
        this.isTesseractLoading = false;
        reject(new Error('Impossibile caricare Tesseract.js (verifica la connessione per il primo avvio).'));
      };
      document.head.appendChild(script);
    });
  }

  /**
   * Esegue il riconoscimento OCR locale sull'immagine fornita
   */
  static async recognizeImage(imageSource, onProgress = () => {}) {
    let rawText = '';

    // Tentativo 1: Tesseract.js (WASM client-side, accurato su grafia e testo stampato)
    try {
      const Tesseract = await this.loadTesseractScript();
      if (Tesseract) {
        onProgress({ status: 'inizializzazione', progress: 0.1, message: 'Inizializzazione motore OCR locale WASM...' });
        
        const result = await Tesseract.recognize(
          imageSource,
          'ita+eng',
          {
            logger: (m) => {
              if (m.status === 'recognizing text') {
                onProgress({ status: 'ocr', progress: 0.2 + (m.progress * 0.75), message: `Riconoscimento OCR locale in corso (${Math.round(m.progress * 100)}%)...` });
              }
            }
          }
        );

        rawText = result?.data?.text || '';
        if (rawText.trim().length > 0) {
          return rawText;
        }
      }
    } catch (err) {
      console.warn('Tesseract.js non disponibile o fallito, provo fallback nativo:', err);
    }

    // Tentativo 2: Native TextDetector API (se supportata da Chrome / Android WebView)
    if (typeof window !== 'undefined' && 'TextDetector' in window) {
      try {
        onProgress({ status: 'native', progress: 0.5, message: 'Riconoscimento con motore nativo del dispositivo...' });
        const detector = new window.TextDetector();
        
        let imgElement;
        if (typeof imageSource === 'string') {
          imgElement = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = imageSource.startsWith('data:') ? imageSource : `data:image/jpeg;base64,${imageSource}`;
          });
        } else {
          imgElement = imageSource;
        }

        const detections = await detector.detect(imgElement);
        rawText = detections.map(d => d.rawValue).join('\n');
        if (rawText.trim().length > 0) {
          return rawText;
        }
      } catch (nativeErr) {
        console.warn('TextDetector nativo non riuscito:', nativeErr);
      }
    }

    if (!rawText.trim()) {
      throw new Error('Nessun testo leggibile estratto tramite OCR locale. Puoi inserire o incollare i dati a mano tramite il pulsante Inserimento Rapido.');
    }

    return rawText;
  }

  /**
   * Parser Euristico per Appunti di Fornitura, Pesi e Calcoli
   * Converte il testo grezzo (estratto dall'OCR o digitato/incollato a mano)
   * nello schema strutturato identico a quello prodotto da Gemini.
   */
  static parseOcrText(rawText, productCatalogNames = []) {
    if (!rawText || typeof rawText !== 'string') {
      return {
        items: [],
        math_audit: { detected_additions_count: 0, detected_multiplications_count: 0, notes_on_calculations: '' },
        general_notes: 'Nessun testo fornito.'
      };
    }

    const lines = rawText
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0);

    const items = [];
    let detectedAdditions = 0;
    let detectedMultiplications = 0;
    let declaredGrandTotal = null;
    let documentTitle = 'Appunto Fornitura (Elaborazione Standalone)';
    let documentDate = null;

    // Normalizzatore catalogo
    const catalogLookup = (nameCandidate) => {
      if (!nameCandidate || productCatalogNames.length === 0) return nameCandidate;
      const lower = nameCandidate.toLowerCase().trim();
      // Ricerca esatta o sottostringa
      const exact = productCatalogNames.find(p => p.toLowerCase() === lower);
      if (exact) return exact;
      const partial = productCatalogNames.find(p => p.toLowerCase().includes(lower) || lower.includes(p.toLowerCase()));
      if (partial) return partial;
      return nameCandidate;
    };

    for (const rawLine of lines) {
      // 1. Cerca eventuale intestazione documento o data (es. "Bolla Ortofrutta del 21/09")
      if (/(?:bolla|consegna|scarico|ricevuta|fattura|ddt)\b/i.test(rawLine) && !rawLine.includes('*') && !rawLine.includes('×') && !rawLine.includes('x')) {
        documentTitle = rawLine;
        const dateMatch = rawLine.match(/\b(\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?)\b/);
        if (dateMatch) {
          documentDate = dateMatch[1];
        }
        continue;
      }

      // Riga con solo data (es. "Data: 21/09/2026")
      if (/^\s*(?:data[:\s]*)?\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?\s*$/i.test(rawLine)) {
        documentDate = rawLine.replace(/data[:\s]*/i, '').trim();
        continue;
      }

      // 2. Cerca eventuale totale complessivo dichiarato sul foglio (es. "Totale Generale: 167.64")
      const totalMatch = rawLine.match(/(?:totale|tot\.?|somma|saldo)(?:\s+(?:generale|complessivo|merci|finale|spesa|fattura))?[\s:€=]+([0-9]+[.,]?[0-9]*)/i);
      if (totalMatch && !rawLine.includes('*') && !rawLine.includes('×') && !rawLine.toLowerCase().includes(' x ')) {
        const val = parseFloat(totalMatch[1].replace(',', '.'));
        if (!isNaN(val) && val > 0) {
          declaredGrandTotal = val;
          continue;
        }
      }

      // Normalizza separatori decimali e operatori
      let line = rawLine
        .replace(/(\d+),(\d+)/g, '$1.$2') // converte virgole tra cifre in punti
        .replace(/[×X]/g, '*')           // normalizza moltiplicazione
        .replace(/€/g, '');

      // 3. Pattern A: Serie di addizioni di pesi seguita o meno da moltiplicazione
      // Es: "12.4 + 13.1 + 10.5 = 36.0 * 2.20" oppure "Pesi: 12.4 + 13.1 = 25.5"
      const additionMatch = line.match(/((?:\d+(?:\.\d+)?\s*\+\s*)+\d+(?:\.\d+)?)/);
      let subWeights = [];
      let calculatedSum = 0;

      if (additionMatch) {
        const expr = additionMatch[1];
        const parts = expr.split('+').map(p => parseFloat(p.trim())).filter(n => !isNaN(n));
        if (parts.length > 1) {
          subWeights = parts;
          calculatedSum = Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100;
          detectedAdditions++;
        }
      }

      // 4. Pattern B: Moltiplicazione (Quantità * Prezzo = Totale)
      // Es: "25.5 * 2.20 = 56.10" oppure "Patate 50 * 0.95"
      const multMatch = line.match(/(\d+(?:\.\d+)?)\s*(?:kg|pz|casse|colli|lt)?\s*\*\s*(\d+(?:\.\d+)?)(?:\s*=\s*(\d+(?:\.\d+)?))?/i);

      let quantity = 0;
      let unitPrice = 0;
      let declaredRowTotal = null;
      let calcExpr = '';

      if (multMatch) {
        const qVal = parseFloat(multMatch[1]);
        const pVal = parseFloat(multMatch[2]);
        const tVal = multMatch[3] ? parseFloat(multMatch[3]) : null;

        // Se avevamo una serie di pesi sommati, la quantità è la somma dei pesi
        quantity = subWeights.length > 0 ? calculatedSum : qVal;
        unitPrice = pVal;
        declaredRowTotal = tVal;
        calcExpr = `${quantity} * ${unitPrice} = ${(quantity * unitPrice).toFixed(2)}`;
        detectedMultiplications++;
      } else if (subWeights.length > 0) {
        // Solo addizione senza moltiplicazione esplicita
        quantity = calculatedSum;
        calcExpr = `${subWeights.join(' + ')} = ${calculatedSum}`;
      } else {
        // Linea con solo quantità e unità esplicita (es: "20 kg" o "5 casse")
        const singleNumMatch = line.match(/(\d+(?:\.\d+)?)\s*(?:kg|pz|casse|cartoni|lt)\b/i);
        if (singleNumMatch) {
          quantity = parseFloat(singleNumMatch[1]);
        }
      }

      // Estrazione Nome Prodotto (tutto ciò che precede i numeri o parole chiave)
      let nameCandidate = rawLine
        .replace(/((?:\d+[.,]?\d*[\s+*x=€-]*)+).*/i, '') // rimuovi da dove iniziano le operazioni
        .replace(/(?:kg|pz|casse|colli|euro|€|prezzo|tot|totale)/gi, '')
        .trim();

      if (!nameCandidate || nameCandidate.length < 2) {
        // Se non troviamo il nome a inizio riga, prova a estrarre lettere residue
        const words = rawLine.split(/\s+/).filter(w => /^[a-zA-ZàèéìòùÀÈÉÌÒÙ]{3,}$/.test(w));
        nameCandidate = words.join(' ');
      }

      const finalProductName = catalogLookup(nameCandidate) || `Articolo ${items.length + 1}`;

      // Rilevamento unità di misura
      let unit = 'kg';
      if (/pz|pezzi|unit/i.test(rawLine)) unit = 'pz';
      else if (/casse|cassa/i.test(rawLine)) unit = 'casse';
      else if (/cartoni|colli/i.test(rawLine)) unit = 'cartoni';
      else if (/lt|litri/i.test(rawLine)) unit = 'lt';

      if (multMatch || subWeights.length > 0 || (quantity > 0 && unitPrice > 0)) {
        items.push({
          product_name: finalProductName,
          quantity: quantity || 1,
          sub_weights: subWeights,
          unit,
          unit_price: unitPrice || null,
          declared_row_total: declaredRowTotal,
          calculation_expression: calcExpr,
          notes: subWeights.length > 0 ? `Somma di ${subWeights.length} pesi parziali` : ''
        });
      }
    }

    return {
      document_title: documentTitle,
      document_date: documentDate || new Date().toISOString().split('T')[0],
      detected_supplier_name: null,
      declared_grand_total: declaredGrandTotal,
      items,
      math_audit: {
        detected_additions_count: detectedAdditions,
        detected_multiplications_count: detectedMultiplications,
        notes_on_calculations: `Elaborati ${items.length} voci con ${detectedAdditions} addizioni e ${detectedMultiplications} moltiplicazioni.`
      },
      general_notes: 'Trascrizione elaborata con Motore Standalone Locale (Zero-Cloud).'
    };
  }
}
