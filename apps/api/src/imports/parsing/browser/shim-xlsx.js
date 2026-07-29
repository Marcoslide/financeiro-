// Usa o SheetJS já carregado globalmente (script xlsx.full.min.js) no HTML.
const XLSX = (typeof globalThis !== 'undefined' && globalThis.XLSX) || {};
module.exports = XLSX;
