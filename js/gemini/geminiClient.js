/**
 * ContiFor - Client Multimodale Gemini Vision con Google AI Studio
 * 
 * Supporta la chiave API di Google AI Studio:
 * - Salvataggio cifrato client-side nel Vault protetto da Master Password.
 * - Test rapido di validità della chiave con feedback visivo.
 * - Forzatura schema JSON strutturato (`response_mime_type: "application/json"`).
 * - System Prompt ingegnerizzato per minimizzare ambiguità della grafia manuale (1 vs 7, virgole).
 * - Rigoroso rispetto della privacy: all'endpoint di Google AI Studio viene inviata unicamente l'immagine.
 */

import { APP_CONFIG } from '../config.js';
import { store } from '../store/state.js';

export class GeminiOCRClient {
  static DEFAULT_MODEL = 'gemini-3.8-flash';
  static FALLBACK_MODEL = 'gemini-3.6-flash';
  static ALTERNATE_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-flash-latest'];
  static API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

  /**
   * System Prompt specializzato nella lettura di appunti manoscritti per forniture
   */
  static getSystemInstruction(productCatalogNames = []) {
    let catalogHint = '';
    if (productCatalogNames && productCatalogNames.length > 0) {
      catalogHint = `
I seguenti sono possibili nomi di prodotti da usare come riferimento lessicale per correggere refusi di lettura (NON inventare prodotti non presenti nell'immagine):
[${productCatalogNames.map(p => `"${p}"`).join(', ')}]
`;
    }

    return `Sei un esperto assistente di trascrizione OCR e riconoscimento ottico specializzato in appunti di fornitura, scontrini, bolle di consegna, elenchi di pesi e calcoli aritmetici scritti rigorosamente A MANO.

OBIETTIVO PRINCIPALE:
Estrai in modo accurato e fedele l'elenco dei prodotti o voci, le quantità/pesi (inclusi pesi parziali sommati), i prezzi unitari, le moltiplicazioni e addizioni scritte a mano, e l'eventuale totale complessivo dichiarato sul foglio.

REGOLE CRITICHE DI RICONOSCIMENTO GRAFIA ED ARITMETICA:
1. DISTINZIONE 1 vs 7:
   - In Europa e in Italia il numero '7' è spesso scritto con un trattino orizzontale al centro ("7"). Se c'è una stanghetta centrale o un'inclinazione netta a destra, è un '7'.
   - Il numero '1' presenta un tratto ascendente corto iniziale e un fusto dritto verticale senza trattino centrale ("1").
2. SEPARATORI DECIMALI (VIRGOLA vs PUNTO):
   - Nei paesi latini il separatore decimale tipico è la virgola (es. "14,5", "8,25", "3,50").
   - Converti SEMPRE i valori numerici in numeri float standard con punto decimale (es. "14,5" diventa 14.5).
3. MOLTIPLICAZIONI E PREZZI UNITARI:
   - Se su una riga compare un'operazione come "14,5 x 2,20 = 31,90" oppure "kg 12 * 1,50", estrai:
     * quantity: 14.5
     * unit_price: 2.20
     * declared_row_total: 31.90
     * calculation_expression: "14.5 * 2.20 = 31.90"
4. ELENCO PESI E ADDIZIONI PARZIALI:
   - Spesso vengono scritti elenchi di pesi parziali sommati (es. serie di casse "12,4 + 13,1 + 12,8 = 38,3").
   - Estrai la lista numerica dei pesi parziali in 'sub_weights' (es. [12.4, 13.1, 12.8]) e il totale della riga in 'quantity' (es. 38.3).
5. DISTINZIONE 4 vs 9, 3 vs 8, 0 vs 6:
   - Fai attenzione alle cifre arrotondate. Il '4' è aperto o triangolare; il '9' ha una pancia chiusa in alto.
6. CANCELLATURE E RIGHE BARRATE:
   - Ignora completamente i numeri o le parole barrate/cancellate. Prendi in considerazione solo i valori finali corretti.
7. UNITÀ DI MISURA:
   - Riconosci "kg", "pz", "casse", "cartoni", "colli", "lt". Se non specificato con cifre decimali, usa "kg"; se numeri interi, "pz". Se manca il nome prodotto, usa "Articolo 1", "Pesi cassa 1", ecc.
8. TOTALE DOCUMENTO DICHIARATO:
   - Se sul fondo del foglio è scritto un totale complessivo (es. "Tot. 154,20" o "Totale € 150"), estrailo nel campo 'declared_grand_total'.

${catalogHint}

OUTPUT OBBLIGATORIO:
Devi restituire ESCLUSIVAMENTE un JSON conforme allo schema specificato, senza blocchi di markdown o testo discorsivo.`;
  }

  /**
   * Schema JSON atteso dalla risposta multimodale
   */
  static getResponseSchema() {
    return {
      type: "OBJECT",
      properties: {
        document_title: {
          type: "STRING",
          description: "Titolo o intestazione rilevata sul foglio (es. Bolla, Appunto Pesi, Data, Nome Fornitore) o null"
        },
        document_date: {
          type: "STRING",
          description: "Eventuale data rilevata nel formato YYYY-MM-DD o stringa originale"
        },
        detected_supplier_name: {
          type: "STRING",
          description: "Eventuale nome fornitore rilevato o scritto sull'appunto"
        },
        declared_grand_total: {
          type: "NUMBER",
          description: "Eventuale totale complessivo in euro scritto a mano sul fondo del foglio"
        },
        items: {
          type: "ARRAY",
          description: "Elenco delle righe o voci estratte dal manoscritto con calcoli",
          items: {
            type: "OBJECT",
            properties: {
              raw_text: {
                type: "STRING",
                description: "Testo originale letto sul foglio per questa riga"
              },
              product_name: {
                type: "STRING",
                description: "Nome normalizzato del prodotto o 'Articolo #' se omesso"
              },
              quantity: {
                type: "NUMBER",
                description: "Quantità o peso numerico decimale rilevato (es. 12.5 o somma pesi)"
              },
              sub_weights: {
                type: "ARRAY",
                items: { type: "NUMBER" },
                description: "Eventuale serie di pesi parziali sommati (es. [12.4, 13.1])"
              },
              unit: {
                type: "STRING",
                description: "Unità di misura (kg, pz, casse, colli, lt, confezioni)"
              },
              unit_price: {
                type: "NUMBER",
                description: "Prezzo unitario scritto a mano sul foglio se presente (es. 2.20)"
              },
              declared_row_total: {
                type: "NUMBER",
                description: "Subtotale o risultato della moltiplicazione scritto a mano (es. 31.90)"
              },
              calculation_expression: {
                type: "STRING",
                description: "Operazione matematica rilevata (es. '14.5 * 2.20 = 31.90' o '12.4 + 13.1 = 25.5')"
              },
              notes: {
                type: "STRING",
                description: "Eventuali chiarimenti (es. 'cifra 7 con trattino', 'somma di 2 pesi')"
              }
            },
            required: ["product_name", "quantity", "unit"]
          }
        },
        math_audit: {
          type: "OBJECT",
          properties: {
            detected_additions_count: { type: "INTEGER" },
            detected_multiplications_count: { type: "INTEGER" },
            notes_on_calculations: { type: "STRING" }
          }
        },
        general_notes: {
          type: "STRING",
          description: "Eventuali annotazioni generali sul grado di leggibilità della grafia"
        }
      },
      required: ["items"]
    };
  }

  /**
   * Ridimensiona e comprime un'immagine client-side per velocizzare l'upload
   */
  static async compressImage(imageFile, maxDimension = 1920, quality = 0.88) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;

          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');

          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          const mimeType = 'image/jpeg';
          const dataUrl = canvas.toDataURL(mimeType, quality);
          const base64 = dataUrl.split(',')[1];

          resolve({ base64, mimeType });
        };
        img.onerror = () => reject(new Error('Impossibile caricare l\'immagine.'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Errore durante la lettura del file.'));
      reader.readAsDataURL(imageFile);
    });
  }

  /**
   * Esegue un test rapido della chiave API di Google AI Studio
   */
  static async testApiKey(apiKey, model = this.DEFAULT_MODEL) {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('Inserisci una chiave API di Google AI Studio valida.');
    }

    let primary = model;
    if (!primary || primary.includes('1.5') || primary.includes('2.5')) {
      primary = this.DEFAULT_MODEL;
    }

    const modelsToTry = [primary, ...this.ALTERNATE_MODELS.filter(m => m !== primary)];
    let lastError = null;

    for (const targetModel of modelsToTry) {
      const testUrl = `${this.API_BASE}/${targetModel}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
      const payload = {
        contents: [
          {
            role: "user",
            parts: [{ text: "Rispondi unicamente con 'OK'." }]
          }
        ]
      };

      try {
        const response = await fetch(testUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          return {
            success: true,
            model: targetModel,
            message: `Chiave Google AI Studio valida e connessione a Gemini (${targetModel}) riuscita!`
          };
        }

        let errMsg = response.statusText;
        try {
          const errJson = await response.json();
          errMsg = errJson?.error?.message || errMsg;
        } catch (e) {}

        if (response.status === 400 && errMsg.includes('API_KEY_INVALID')) {
          throw new Error('La chiave inserita non è valida. Assicurati di copiarla correttamente da Google AI Studio.');
        }

        // Se 404 (modello non supportato per questo tipo di account/chiave), prova il successivo
        lastError = new Error(`Errore Google AI Studio (${response.status}): ${errMsg}`);
      } catch (err) {
        if (err.message.includes('non è valida')) throw err;
        lastError = err;
      }
    }

    throw lastError || new Error('Impossibile verificare la chiave con i modelli disponibili.');
  }

  /**
   * Risolve la chiave effettiva: da impostazioni salvate o da config
   */
  static getEffectiveApiKey() {
    const userKey = store?.getSettings()?.geminiApiKey;
    if (userKey && userKey.trim().length > 0) {
      return userKey.trim();
    }
    return APP_CONFIG.GEMINI_API_KEY || '';
  }

  /**
   * Esegue l'analisi OCR del foglio manoscritto
   */
  static async analyzeHandwrittenNote({
    apiKey,
    imageBase64,
    mimeType = 'image/jpeg',
    model,
    productCatalog = []
  }) {
    const effectiveKey = (apiKey && apiKey.trim()) || this.getEffectiveApiKey();
    const proxyEndpoint = APP_CONFIG.PROXY_ENDPOINT;
    let targetModel = model || store?.getSettings()?.geminiModel || this.DEFAULT_MODEL;
    // Se era impostato un vecchio modello non più attivo, aggiorna immediatamente a gemini-3.8-flash
    if (!targetModel || targetModel.includes('2.5') || targetModel.includes('1.5')) {
      targetModel = 'gemini-3.8-flash';
    }

    if (!effectiveKey && !proxyEndpoint) {
      throw new Error('Chiave API di Google AI Studio non configurata. Inseriscila nelle Impostazioni o nella schermata di scansione.');
    }

    const systemInstructionText = this.getSystemInstruction(productCatalog);
    const responseSchema = this.getResponseSchema();

    const requestPayload = {
      system_instruction: {
        parts: [{ text: systemInstructionText }]
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Analizza questo appunto manoscritto di fornitura. Estrai accuratamente tutti i prodotti, i pesi/quantità e le unità di misura rilevati secondo lo schema JSON."
            },
            {
              inline_data: {
                mime_type: mimeType,
                data: imageBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        response_mime_type: "application/json",
        response_schema: responseSchema,
        temperature: 0.1,
        max_output_tokens: 4096
      }
    };

    const modelsToTry = [targetModel, ...this.ALTERNATE_MODELS.filter(m => m !== targetModel)];
    let lastError = null;

    for (const currentModel of modelsToTry) {
      const targetUrl = proxyEndpoint 
        ? proxyEndpoint 
        : `${this.API_BASE}/${currentModel}:generateContent?key=${encodeURIComponent(effectiveKey.trim())}`;

      let response;
      try {
        response = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload)
        });
      } catch (networkErr) {
        throw new Error(`Errore di connessione a Google AI Studio: ${networkErr.message}. Verifica la connessione internet.`);
      }

      if (response.ok) {
        const data = await response.json();
        const candidate = data?.candidates?.[0];
        const textResult = candidate?.content?.parts?.[0]?.text;

        if (!textResult) {
          throw new Error('Google AI Studio non ha restituito alcun testo o contenuto.');
        }

        try {
          return JSON.parse(textResult);
        } catch (parseError) {
          throw new Error('La risposta da Google AI Studio non è in formato JSON valido: ' + parseError.message);
        }
      }

      let errorDetails = '';
      try {
        const errorJson = await response.json();
        errorDetails = errorJson?.error?.message || response.statusText;
      } catch (e) {
        errorDetails = await response.text();
      }

      if (response.status === 400 && errorDetails.includes('API_KEY_INVALID')) {
        throw new Error('La chiave Google AI Studio non è valida. Verificala nelle Impostazioni.');
      }

      // Se il modello è deprecato (404) o temporaneamente congestionato (503), prova il modello alternativo
      console.warn(`Tentativo con ${currentModel} fallito (${response.status}: ${errorDetails}). Tentativo con modello alternativo...`);
      lastError = new Error(`Errore Google AI Studio (${response.status}): ${errorDetails}`);
    }

    throw lastError || new Error('Impossibile elaborare l\'immagine con i modelli Gemini disponibili.');

    const data = await response.json();
    const candidate = data?.candidates?.[0];
    const textResult = candidate?.content?.parts?.[0]?.text;

    if (!textResult) {
      throw new Error('Google AI Studio non ha restituito alcun testo o contenuto.');
    }

    try {
      return JSON.parse(textResult);
    } catch (parseError) {
      throw new Error('La risposta da Google AI Studio non è in formato JSON valido: ' + parseError.message);
    }
  }
}
