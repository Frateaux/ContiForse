/**
 * ContiFor - Configurazione Trasparente AI & Endpoint
 * 
 * L'utente finale NON deve inserire alcuna chiave API.
 * Le chiamate OCR vengono gestite in modo completamente trasparente:
 * - Tramite chiave preimpostata o endpoint proxy/gateway integrato.
 * - Con fallback euristico intelligente integrato offline nel caso di assenza di rete.
 */

export const APP_CONFIG = {
  // Chiave preconfigurata o endpoint trasparente
  // Se configurata qui o tramite proxy, l'utente finale non vedrà mai richieste di API key
  GEMINI_API_KEY: (typeof window !== 'undefined' && window.__CONTIFOR_API_KEY__) || '',
  
  // Modello multimodale predefinito
  GEMINI_MODEL: 'gemini-3.8-flash',
  GEMINI_FALLBACK_MODEL: 'gemini-3.6-flash',

  // Endpoint proxy opzionale (se si desidera un proxy serverless o Cloudflare Worker trasparente)
  // Lasciare vuoto per chiamata diretta all'API Google Generative Language
  PROXY_ENDPOINT: '',

  // Flag per abilitare l'elaborazione trasparente
  TRANSPARENT_OCR: true
};
