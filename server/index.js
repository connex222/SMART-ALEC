'use strict';
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const {Server} = require('socket.io');
const QRCode = require('qrcode');
const {attachGateway} = require('./gateway');
const {GameRooms} = require('./rooms');
const {allLanAddresses} = require('./network');
const {listenWithFallback} = require('./port-listener');
const layout = require('./board-layout');
const questions = require('./questions');
const pkg = require('../package.json');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', Boolean(process.env.RENDER || process.env.TRUST_PROXY === '1') ? 1 : false);
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Frame-Options', 'DENY');
  res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self' ws: wss:; base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
  next();
});
const publicDir = path.join(__dirname, '..', 'public');
app.get('/', (req, res) => res.redirect('/tv/'));
app.get(/^\/tv$/, (req, res) => res.redirect('/tv/'));
app.get(/^\/play$/, (req, res) => res.redirect('/play/'));
app.get('/health', (req, res) => res.json({ok: true, game: 'Smart Alec', version: pkg.version, questions: questions.counts()}));
// The board layout is static; screens fetch it once.
app.get('/api/layout', (req, res) => res.json({size: layout.SIZE, spaces: layout.SPACES, categories: layout.CATEGORIES, minigame: layout.MINIGAME, specials: layout.SPECIALS}));
app.use(express.static(publicDir, {
  dotfiles: 'deny',
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  setHeaders(res, filePath) { if (/\.(?:html|js|css|json)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-store, max-age=0'); },
}));
app.use((req, res) => res.status(404).send('Not found'));

const server = http.createServer(app);
const io = new Server(server, {serveClient: true, transports: ['websocket', 'polling'], maxHttpBufferSize: 64 * 1024, connectionStateRecovery: {maxDisconnectionDuration: 30_000}});
attachGateway(io, {QRCode, rooms: new GameRooms()});

listenWithFallback(server, {
  port: Number(process.env.PORT) || 3000,
  autoFallback: process.env.SMART_ALEC_AUTO_PORT === '1' && !process.env.RENDER && process.env.NODE_ENV !== 'production',
  onRetry: (busy, next) => console.warn(`Port ${busy} is busy. Trying ${next}...`),
  onListening: port => {
    process.env.SMART_ALEC_ACTIVE_PORT = String(port);
    console.log('');
    console.log('=========================================');
    console.log('SMART ALEC IS RUNNING');
    console.log(`TV:     http://localhost:${port}/tv/`);
    const ip = allLanAddresses()[0];
    if (ip) console.log(`PHONES: http://${ip}:${port}/play/`);
    console.log('=========================================');
  },
  onFailure: (error, port) => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : `Could not start: ${error.message}`);
    process.exit(1);
  },
});
