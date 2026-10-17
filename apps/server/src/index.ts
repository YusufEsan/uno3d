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
// izinli web adresleri: Pages sitesi ve yerel geliştirme; ALLOWED_ORIGINS ile değiştirilebilir
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'https://yusufesan.github.io,http://localhost:5173,http://localhost:3001')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const io = new Server(http, {
  cors: { origin: allowedOrigins, credentials: false },
  // tek bir mesaj en fazla 100 KB olabilir: kötüye kullanılan büyük paketleri baştan keser
  maxHttpBufferSize: 100_000,
});
app.disable('x-powered-by');

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
