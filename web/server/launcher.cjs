'use strict';

/**
 * jInvoice standalone launcher.
 * Serves the built frontend and opens the default browser.
 * OAuth is handled by the deployed proxy (VITE_AUTH_BASE in .env).
 * Packaged with pkg — no secrets embedded.
 */

const path    = require('path');
const { exec } = require('child_process');
const express  = require('express');

const DIST = process.pkg
  ? path.join(path.dirname(process.execPath), 'dist')
  : path.join(__dirname, '..', 'dist');

const PORT = 7823;

const app = express();
app.use(express.static(DIST));
app.get('/*path', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));

app.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  const openCmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(openCmd);
  console.log(`jInvoice running at ${url}`);
  console.log('Keep this window open while using jInvoice.');
  console.log('Press Ctrl+C to quit.');
});

process.stdin.resume();
