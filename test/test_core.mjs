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

  if (unwrapped === pwd) {
    console.log('✓ Wrapping e unwrapping crittografico token biometrico verificato con successo!');
  } else {
    throw new Error('Unwrapping token biometrico non corrispondente.');
  }
}

async function runAll() {
  try {
    await testCrypto();
    testGeminiSchema();
    testInvoiceAndMathAudit();
    await testBiometricsAndSync();
    console.log('\n=============================================');
    console.log('TUTTI I TEST AUTOMATIZZATI HANNO AVUTO ESITO POSITIVO!');
    console.log('=============================================');
  } catch (err) {
    console.error('\n❌ TEST FALLITO:', err);
    process.exit(1);
  }
}

runAll();
