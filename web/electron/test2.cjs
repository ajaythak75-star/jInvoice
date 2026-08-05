'use strict';
// Electron 43 uses 'electron/main' for main process API access in some versions
try {
  const e1 = require('electron');
  console.log('electron type:', typeof e1, typeof e1 === 'object' ? JSON.stringify(Object.keys(e1).slice(0,5)) : e1);
} catch(e) { console.log('electron error:', e.message); }

// Try node built-ins to confirm we're in Electron
console.log('process.versions.electron:', process.versions.electron);
console.log('process.versions.node:', process.versions.node);
console.log('process.type:', process.type);
