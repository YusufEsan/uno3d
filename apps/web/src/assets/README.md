# Gerçekçi karakterleri ekleme (Mixamo)

Oyun, bu klasöre koyduğun dosyaları **kendiliğinden bulur**: kod değiştirmen ya da liste tutman gerekmez.
Klasörler boşken geçici robot karakterler kullanılır.

```
src/assets/
├─ characters/   ← karakterler (her dosya bir karakter, dosya adı = karakter adı)
│   ├─ ayse.fbx
│   ├─ mert.fbx
│   └─ ...
└─ animations/   ← animasyonlar (tüm karakterlerde ortak kullanılır)
    ├─ idle.fbx
    ├─ laugh.fbx
    └─ ...
```

## 1. Hesap

[mixamo.com](https://www.mixamo.com) adresine ücretsiz bir Adobe hesabıyla gir.
Mixamo karakterleri ve animasyonları oyunlarda ücretsiz kullanılabilir.

## 2. Karakterleri indir (4–8 tane önerilir)

1. Üstte **Characters** sekmesine geç ve beğendiğin bir insan karakterini seç.
2. Sağ üstte **Download**'a bas ve şu ayarları kullan:
   - Format: **FBX Binary (.fbx)**
   - Pose: **T-pose**
3. Dosyayı `characters/` klasörüne kısa bir adla kaydet, ör. `ayse.fbx`, `mert.fbx`.
   Adda sadece küçük harf, rakam, `-` ve `_` kullan; oyunda bu ad görünür.

> Karakterlerin yüz ifadesi (blendshape) varsa ağız hareketi ve göz kırpma kendiliğinden çalışır.
> Standart Mixamo karakterlerinin çoğunda yüz ifadesi yoktur; o zaman konuşma baş ve çene hareketiyle gösterilir.

## 3. Animasyonları indir

**Animations** sekmesinde aşağıdaki aramaları yap ve **oturarak yapılan** sürümleri seç.
Her birini indirirken:

- Format: **FBX Binary (.fbx)**
- Skin: **Without Skin** (dosya küçük olur; animasyon bütün karakterlerde çalışır)
- Frames per second: 30

Dosyayı **tablodaki adla** `animations/` klasörüne kaydet:

| Dosya adı | Mixamo'da ara | Ne zaman oynar | Gerekli mi |
|---|---|---|---|
| `idle.fbx` | Sitting Idle | Sürekli: oturma döngüsü | **Evet** |
| `idle2.fbx`, `idle3.fbx` … | Sitting Idle (farklı olanlar), Sitting, Seated Idle | Ara sıra geçilen kıpırdanmalar | Önerilir |
| `talk.fbx` | Sitting Talking | Sesli sohbette konuşurken | Önerilir |
| `laugh.fbx` | Sitting Laughing | Gülme emote'u | Önerilir |
| `clap.fbx` | Sitting Clap | Beğenme/kutlama yedeği | İsteğe bağlı |
| `thumbsup.fbx` | Sitting Thumbs Up | Beğen emote'u | İsteğe bağlı |
| `angry.fbx` | Sitting Angry, Sitting Disapproval | Masaya vur emote'u, kızma | Önerilir |
| `disbelief.fbx` | Sitting Disbelief | +2/+4 yiyince, "hayır" emote'u | Önerilir |
| `sad.fbx` | Sitting Sad, Defeated (sitting) | Ceza kartı çekince, kaybedince | Önerilir |
| `victory.fbx` | Sitting Victory | Kazanınca, dans emote'u | Önerilir |
| `yell.fbx` | Sitting Yell | "UNO!" anı | Önerilir |
| `wave.fbx` | Waving (oturarak olanı varsa onu) | El salla emote'u | İsteğe bağlı |

Eksik olanlar sorun değil: tepkiler sırayla yedek animasyonlara düşer (ör. `thumbsup` yoksa `clap`).
Ayakta yapılan bir animasyon seçersen karakter o an ayağa kalkar.

## 4. Dene

Geliştirme sunucusu çalışıyorsa sayfayı yenile. Ana ekranda avatar listesi robotlar yerine senin karakterlerinle dolar.
Botlar da bu karakterlerden birini kendiliğinden alır.

Karakter koltukta yanlış duruyorsa (çok önde, gömülü vb.) `src/scene/Avatar.tsx` dosyasındaki `SIT.mixamo` değerleriyle
(`height` ve `forward`) ince ayar yapılabilir.

## Notlar

- `.fbx` dosyaları birkaç MB tutabilir. Yayına alırken boyutu düşürmek için `.glb`'ye çevrilebilir; `characters/` klasörü `.glb` dosyalarını da tanır.
- Robot modeli internetten (threejs.org) yüklenir. Yayına almadan önce gerçek karakterleri eklemek bu bağımlılığı ortadan kaldırır.
