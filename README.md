# UNO 3D

Tarayıcıda, 3D bir masada arkadaşlarınla (ya da botlarla) online UNO.

## Çalıştırma

```bash
npm install
npm run dev
```

- Web: http://localhost:5173 (oyun sunucusu 3001 portunda, Vite bağlantıyı ona aktarır)
- Arkadaşını davet etmek için lobideki "Davet linkini kopyala" düğmesini kullan.
- Aynı bilgisayarda test için iki ayrı sekme açman yeterli; her sekme ayrı oyuncudur.

## Yapı

| Klasör | İçerik |
|---|---|
| `packages/engine` | Oyun kuralları (saf TypeScript, testli): kart etkileri, sıra, otomatik UNO, puan, botlar |
| `packages/protocol` | İstemci ↔ sunucu mesajları (zod ile doğrulanır) |
| `apps/server` | Node + Socket.IO: odalar, hızlı eşleşme, botlar, süre, yeniden bağlanma, sesli sohbet sinyali |
| `apps/web` | React + React Three Fiber: 3D masa, karakterler, kart animasyonları, arayüz |

## Gerçekçi karakterler

Mixamo karakterlerini ve animasyonlarını eklemek için: [apps/web/src/assets/README.md](apps/web/src/assets/README.md)

## Komutlar

```bash
npm test          # oyun kuralı testleri
npm run typecheck # tüm paketlerde tip kontrolü
npm run build     # web uygulamasını derler; ardından `npm start` hem sunucuyu hem web'i 3001'de yayınlar
```
