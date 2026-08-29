'use strict';

/**
 * jInvoice standalone launcher.
 * Serves the built frontend and opens the default browser.
 * Uses only Node.js built-ins — no express — so pkg bundles cleanly on all platforms.
 */

const http   = require('http');
const path   = require('path');
const fs     = require('fs');
const { exec } = require('child_process');

const DIST = process.pkg
  ? path.join(path.dirname(process.execPath), 'dist')
  : path.join(__dirname, '..', 'dist');

const PORT = 7823;

const MIME = {
  '.html':        'text/html; charset=utf-8',
  '.js':          'application/javascript',
  '.mjs':         'application/javascript',
  '.css':         'text/css',
  '.png':         'image/png',
  '.svg':         'image/svg+xml',
  '.ico':         'image/x-icon',
  '.json':        'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff':        'font/woff',
  '.woff2':       'font/woff2',
};

// Fail fast with a readable message if dist/ is missing (e.g. ran from inside zip)
if (!fs.existsSync(DIST)) {
  console.error('\n  ERROR: Cannot find the "dist" folder.');
  console.error('  Make sure you unzipped the file before running jInvoice.exe');
  console.error('  Expected location: ' + DIST);
  console.error('\n  Press Enter to close...');
  process.stdin.once('data', () => process.exit(1));
  process.stdin.resume();
  // keep process alive for the message
  return;
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  let filePath  = path.join(DIST, urlPath);

  // No extension → SPA route → serve index.html
  if (!path.extname(filePath)) {
    filePath = path.join(DIST, 'index.html');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Fallback to index.html for any missing file (SPA deep links)
      fs.readFile(path.join(DIST, 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(d2);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  const openCmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
    ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(openCmd);
  console.log('');
  console.log('  ✓ jInvoice is running!');
  console.log('  → Open: ' + url);
  console.log('');
  console.log('  Keep this window open while using jInvoice.');
  console.log('  Press Ctrl+C to quit.');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('\n  ERROR: Port ' + PORT + ' is already in use.');
    console.error('  Close any other jInvoice window and try again.\n');
  } else {
    console.error('\n  ERROR: ' + err.message + '\n');
  }
  console.log('  Press Enter to close...');
  process.stdin.once('data', () => process.exit(1));
});

process.on('uncaughtException', (err) => {
  console.error('\n  UNEXPECTED ERROR: ' + err.message);
  console.error(err.stack || '');
  console.log('\n  Press Enter to close...');
  process.stdin.once('data', () => process.exit(1));
});

process.stdin.resume();
