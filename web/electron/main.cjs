'use strict';

// Debug log to file so we can see what happens in packaged app
const fs = require('fs');
const os = require('os');
const path = require('path');
const logFile = path.join(os.homedir(), 'jinvoice-debug.log');
const log = (...args) => {
  const line = args.join(' ') + '\n';
  fs.appendFileSync(logFile, line);
  console.log(...args);
};

log('=== jInvoice starting ===');
log('process.type:', process.type);
log('process.versions.electron:', process.versions.electron);
log('process.versions.node:', process.versions.node);
log('__dirname:', __dirname);

try {
  const e = require('electron');
  log('electron typeof:', typeof e);
  log('electron value:', typeof e === 'string' ? e : JSON.stringify(Object.keys(e || {}).slice(0, 5)));
} catch(err) {
  log('electron require error:', err.message);
}

log('=== done ===');
