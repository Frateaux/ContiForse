import fs from 'fs';
import path from 'path';

const files = [
  'js/config.js',
  'js/crypto/vault.js',
  'js/crypto/biometrics.js',
  'js/storage/pendingScansStorage.js',
  'js/sync/githubSync.js',
  'js/ui/toast.js',
  'js/ui/charts.js',
  'js/ui/invoiceGenerator.js',
  'js/store/state.js',
  'js/gemini/geminiClient.js',
  'js/views/authModal.js',
  'js/views/scanView.js',
  'js/views/archiveView.js',
  'js/views/suppliersView.js',
  'js/views/reportView.js',
  'js/views/settingsView.js',
  'js/app.js'
];

let bundleContent = `/**
 * ContiFor - Standalone Universal Bundle
 * Funziona sia tramite server HTTP (GitHub Pages / localhost) sia tramite doppio click locale (file://)
 */
(function() {
  'use strict';
`;

for (const relPath of files) {
  const fullPath = path.resolve('c:/Users/Utente/Desktop/conti_for', relPath);
  let code = fs.readFileSync(fullPath, 'utf8');

  // Rimuovi import statements
  code = code.replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '');
  
  // Rimuovi export default, export class, export const, export function, export { ... }
  code = code.replace(/export\s+default\s+/g, '');
  code = code.replace(/export\s+class\s+/g, 'class ');
  code = code.replace(/export\s+const\s+/g, 'const ');
  code = code.replace(/export\s+let\s+/g, 'let ');
  code = code.replace(/export\s+function\s+/g, 'function ');
  code = code.replace(/export\s*\{[^}]*\};?/g, '');

  bundleContent += `\n// --- MODULE: ${relPath} ---\n`;
  bundleContent += code + '\n';
}

bundleContent += `
})();
`;

fs.writeFileSync('c:/Users/Utente/Desktop/conti_for/bundle.js', bundleContent, 'utf8');
console.log('✓ bundle.js generato con successo! Dimensione:', bundleContent.length, 'bytes');
