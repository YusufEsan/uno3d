import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { registerHandlers } from './handlers';

// geliştirmede --port ile sabitlenir (önizleme araçlarının verdiği PORT değişkeni Vite içindir)
const portArg = process.argv.indexOf('--port');
const PORT = Number(portArg > 0 ? process.argv[portArg + 1] : (process.env.PORT ?? 3001));
const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: true } });

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Üretimde derlenmiş web uygulamasını da aynı sunucu yayınlar
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.use((_req, res) => res.sendFile(resolve(webDist, 'index.html')));
}

registerHandlers(io);

http.listen(PORT, () => {
  console.log(`UNO sunucusu http://localhost:${PORT} adresinde çalışıyor`);
});
