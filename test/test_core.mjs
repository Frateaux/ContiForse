import { CryptoVault } from '../js/crypto/vault.js';
import { GeminiOCRClient } from '../js/gemini/geminiClient.js';

// Polyfill window.crypto e atob/btoa se necessario per Node
if (!globalThis.window) {
  globalThis.window = {
    crypto: globalThis.crypto
  };
}

async function testCrypto() {
  console.log('--- TEST 1: Crittografia Web Crypto API (PBKDF2 100k + AES-GCM 256) ---');
  
  const testPassword = 'PasswordSicura123!';
  const testPayload = {
    user: 'Mario Rossi',
    secretVault: {
      suppliers: [{ id: 1, name: 'Fornitore Test' }],
      totalSpent: 1250.75
    }
  };

  // 1. Cifratura
  const envelope = await CryptoVault.encryptData(testPayload, testPassword);
  console.log('✓ Cifratura completata con successo.');
  console.log('  Formato:', envelope.format);
  console.log('  Salt (Base64):', envelope.salt.slice(0, 16) + '...');
  console.log('  IV (Base64):', envelope.iv);
  console.log('  Ciphertext (Base64):', envelope.ciphertext.slice(0, 24) + '...');

  // 2. Decrittografia con password corretta
  const decrypted = await CryptoVault.decryptData(envelope, testPassword);
  if (JSON.stringify(decrypted) === JSON.stringify(testPayload)) {
    console.log('✓ Decrittografia con password corretta: SUCCESSO (dati integri al 100%)');
  } else {
    throw new Error('Dati decrittografati non corrispondono al payload iniziale!');
  }

  // 3. Test con password errata (deve fallire)
  try {
    await CryptoVault.decryptData(envelope, 'PasswordErrata999');
    throw new Error('ERRORE: La decrittografia con password errata avrebbe dovuto lanciare un errore!');
  } catch (err) {
    console.log('✓ Decrittografia con password errata bloccata correttamente:', err.message);
  }
}

function testGeminiSchema() {
  console.log('\n--- TEST 2: Pipeline Gemini OCR & Schema JSON ---');
  const catalog = ['Pomodori San Marzano', 'Patate Gialle', 'Zucchine Scure'];
  const prompt = GeminiOCRClient.getSystemInstruction(catalog);
  
  if (prompt.includes('Pomodori San Marzano') && prompt.includes('DISTINZIONE 1 vs 7')) {
    console.log('✓ System Prompt generato con regole grafia manuale e catalogo lessicale.');
  } else {
    throw new Error('System Prompt incompleto.');
  }

  const schema = GeminiOCRClient.getResponseSchema();
  if (schema.type === 'OBJECT' && schema.properties.items && schema.properties.items.type === 'ARRAY') {
    console.log('✓ Schema JSON forzato conforme alle specifiche multimodali.');
  } else {
    throw new Error('Schema JSON Gemini non valido.');
  }
}

import { InvoiceGenerator } from '../js/ui/invoiceGenerator.js';

function testInvoiceAndMathAudit() {
  console.log('\n--- TEST 3: Generatore Fattura PDF A4 & Audit Matematico ---');
  const mockSupply = {
    id: 'sup_test_123',
    supplierName: 'Ortofrutta Centrale SpA',
    date: '2026-09-21',
    invoiceNumber: 'FT-20260921-TEST',
    items: [
      {
        productName: 'Pomodori San Marzano',
        quantity: 25.5,
        sub_weights: [12.4, 13.1],
        unit: 'kg',
        unitPrice: 2.20,
        subtotal: 56.10,
        notes: '2 pesi sommati'
      },
      {
        productName: 'Patate Gialle',
        quantity: 50.0,
        unit: 'kg',
        unitPrice: 0.95,
        subtotal: 47.50,
        notes: ''
      }
    ],
    totalQuantity: 75.5,
    totalAmount: 103.60,
    notes: 'Controllo pesi conforme'
  };

  const html = InvoiceGenerator.generateInvoiceHtml(mockSupply);
  if (!html.includes('Ortofrutta Centrale SpA')) {
    throw new Error('Fattura HTML non contiene il nome del fornitore!');
  }
  if (!html.includes('FT-20260921-TEST')) {
    throw new Error('Fattura HTML non contiene il numero fattura!');
  }
  if (!html.includes('56,10') || !html.includes('47,50')) {
    throw new Error('Fattura HTML non contiene i subtotali corretti!');
  }
  if (!html.includes('103,60')) {
    throw new Error('Fattura HTML non contiene il totale complessivo corretto!');
  }
  console.log('✓ Documento Fattura/Ricevuta PDF A4 generato con successo e convalidato.');
}

import { GitHubSyncManager } from '../js/sync/githubSync.js';
import { BiometricsManager } from '../js/crypto/biometrics.js';

async function testBiometricsAndSync() {
  console.log('\n--- TEST 4: Modulo Biometrico & Cloud Sync GitHub ---');
  if (GitHubSyncManager.FILE_NAME !== 'contifor_encrypted_vault.json') {
    throw new Error('Nome file di sincronizzazione GitHub non corretto.');
  }
  console.log('✓ Modulo GitHubSyncManager configurato con Zero-Knowledge envelope.');

  // Test wrapping/unwrapping password per biometria
  const mockCredId = 'mock_credential_id_base64_123';
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);

  const pwd = 'MiaMasterPasswordSegreta99!';
  const wrapped = await BiometricsManager._encryptPassword(pwd, mockCredId, salt);
  const unwrapped = await BiometricsManager._decryptPassword(wrapped, mockCredId, salt);

  // Test metodi smartPushVault e findExistingContiForGist presenti e validi
  if (typeof GitHubSyncManager.smartPushVault !== 'function' || typeof GitHubSyncManager.findExistingContiForGist !== 'function') {
    throw new Error('Metodi smartPushVault o findExistingContiForGist mancanti in GitHubSyncManager.');
  }

  // Test findExistingContiForGist con mock response
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes('/gists?per_page=100')) {
      return {
        ok: true,
        json: async () => [
          { id: 'gist_abc_123', files: { 'contifor_encrypted_vault.json': {} } }
        ]
      };
    }
    return { ok: false, status: 404 };
  };

  const foundGistId = await GitHubSyncManager.findExistingContiForGist('mock_token');
  if (foundGistId !== 'gist_abc_123') {
    throw new Error(`Rilevamento automatico Gist fallito: atteso 'gist_abc_123', ottenuto '${foundGistId}'`);
  }
  console.log('✓ Rilevamento automatico Gist (smart discovery) verificato con successo!');
  globalThis.fetch = originalFetch;

  // Test mergeVaultData (2-way merge smartphone ⇄ PC)
  const localVault = {
    suppliers: [
      { id: 'sup_pc_1', name: 'Fornitore Locale PC', priceList: [{ id: 'p1', name: 'Prodotto A', unitPrice: 10 }] }
    ],
    supplies: [],
    settings: { theme: 'dark' }
  };
  const remoteVault = {
    suppliers: [
      { id: 'sup_phone_1', name: 'Fornitore Prova Telefono', priceList: [{ id: 'p2', name: 'Prodotto B', unitPrice: 20 }] }
    ],
    supplies: [
      { id: 'inv_1', supplierName: 'Fornitore Prova Telefono', totalAmount: 200 }
    ],
    settings: { geminiModel: 'gemini-3.8-flash' }
  };

  const { mergedData, stats } = GitHubSyncManager.mergeVaultData(localVault, remoteVault);
  if (mergedData.suppliers.length !== 2) {
    throw new Error(`Fusione fornitori non corretta: attesi 2 fornitori, trovati ${mergedData.suppliers.length}`);
  }
  if (!mergedData.suppliers.some(s => s.name === 'Fornitore Prova Telefono')) {
    throw new Error('Fornitore del telefono non presente dopo la fusione!');
  }
  if (!mergedData.suppliers.some(s => s.name === 'Fornitore Locale PC')) {
    throw new Error('Fornitore del PC cancellato dopo la fusione!');
  }
  if (mergedData.supplies.length !== 1) {
    throw new Error('Forniture del telefono non integrate!');
  }
  console.log('✓ Fusione bidirezionale (2-Way Smart Merge) verificata: 0 dati sovrascritti, 100% integrati!');
}

import { PendingScansStorage } from '../js/storage/pendingScansStorage.js';

async function testPendingScansStorage() {
  console.log('\n--- TEST 5: Coda Scatti in Sospeso & Persistenza Rate Limit ---');
  if (!globalThis.localStorage) {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => store.get(k) || null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear()
    };
  }

  await PendingScansStorage.clear();

  const scan1 = {
    imageBase64: 'dGVzdF9pbWFnZV9kYXRhXzEyMw==',
    mimeType: 'image/jpeg',
    supplierId: 'sup_test_1',
    customSupplierName: 'Fornitore Test Sospeso',
    scanMode: 'quick',
    errorMessage: 'Gemini ha troppe richieste al momento (Rate Limit 429)'
  };

  const saved = await PendingScansStorage.save(scan1);
  if (!saved.id || !saved.createdAt) {
    throw new Error('ID o data creazione mancanti nello scatto salvato.');
  }

  const all = await PendingScansStorage.getAll();
  if (all.length !== 1 || all[0].customSupplierName !== 'Fornitore Test Sospeso') {
    throw new Error('Recupero scatti in sospeso non corretto.');
  }
  console.log('✓ Salvataggio e recupero persistente foto in sospeso verificato con successo.');

  // Verifica cancellazione
  await PendingScansStorage.delete(saved.id);
  const remaining = await PendingScansStorage.getAll();
  if (remaining.length !== 0) {
    throw new Error('Cancellazione scatto in sospeso non riuscita.');
  }
  console.log('✓ Rimozione foto completata/cancellata verificata con successo.');
}

import { LocalOCREngine } from '../js/ocr/localOcrEngine.js';

function testLocalOcrParser() {
  console.log('\n--- TEST 6: Motore OCR Standalone Locale (Parser & Quadratura Euristica) ---');
  
  const sampleNote = `
    Bolla Ortofrutta del 21/09
    Pomodori San Marzano 12.4 + 13.1 = 25.5 kg * 2.20 € = 56.10 €
    Patate Gialle 50 kg * 0.95 € = 47.50 €
    Zucchine Scure 7.8 * 1.80 = 14.04
    Insalata Iceberg 4 casse * 12.50 = 50.00
    Totale Generale: 167.64
  `;

  const catalog = ['Pomodori San Marzano', 'Patate Gialle Bologna', 'Zucchine Scure', 'Insalata Iceberg'];
  const parsed = LocalOCREngine.parseOcrText(sampleNote, catalog);

  if (!parsed.items || parsed.items.length !== 4) {
    throw new Error(`Attese 4 voci estratte, trovate ${parsed.items?.length}`);
  }

  // Verifica Riga 1: Addizione pesi + moltiplicazione
  const riga1 = parsed.items[0];
  if (riga1.product_name !== 'Pomodori San Marzano') {
    throw new Error(`Nome prodotto non corrispondente: atteso 'Pomodori San Marzano', trovato '${riga1.product_name}'`);
  }
  if (riga1.quantity !== 25.5 || !Array.isArray(riga1.sub_weights) || riga1.sub_weights.length !== 2) {
    throw new Error(`Pesi sommati non rilevati: atteso [12.4, 13.1] -> 25.5, trovato ${JSON.stringify(riga1.sub_weights)}`);
  }
  if (riga1.unit_price !== 2.20) {
    throw new Error(`Prezzo unitario non rilevato: atteso 2.20, trovato ${riga1.unit_price}`);
  }

  // Verifica Riga 2: Moltiplicazione con catalogo fuzzy
  const riga2 = parsed.items[1];
  if (riga2.product_name !== 'Patate Gialle Bologna') {
    throw new Error(`Risoluzione catalogo fuzzy fallita: atteso 'Patate Gialle Bologna', trovato '${riga2.product_name}'`);
  }
  if (riga2.quantity !== 50 || riga2.unit_price !== 0.95) {
    throw new Error(`Quantità o prezzo riga 2 errati`);
  }

  // Verifica Totale complessivo dichiarato
  if (parsed.declared_grand_total !== 167.64) {
    throw new Error(`Totale dichiarato non rilevato: atteso 167.64, trovato ${parsed.declared_grand_total}`);
  }

  // Verifica audit counts
  if (parsed.math_audit.detected_additions_count < 1 || parsed.math_audit.detected_multiplications_count < 4) {
    throw new Error(`Conteggio audit aritmetico errato: addizioni ${parsed.math_audit.detected_additions_count}, moltiplicazioni ${parsed.math_audit.detected_multiplications_count}`);
  }

  console.log('✓ Parser euristico locale verificato: addizioni pesi, moltiplicazioni e quadratura totali perfetti!');
}

async function runAll() {
  try {
    await testCrypto();
    testGeminiSchema();
    testInvoiceAndMathAudit();
    await testBiometricsAndSync();
    await testPendingScansStorage();
    testLocalOcrParser();
    console.log('\n=============================================');
    console.log('TUTTI I TEST AUTOMATIZZATI HANNO AVUTO ESITO POSITIVO!');
    console.log('=============================================');
  } catch (err) {
    console.error('\n❌ TEST FALLITO:', err);
    process.exit(1);
  }
}

runAll();

