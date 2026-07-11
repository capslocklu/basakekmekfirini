# Başak Ekmek Fırını — Sipariş Yönetimi Uygulaması

Bu zip içinde uygulamanın tam kaynak kodu ve APK'ya paketlemek için gereken
tüm dosyalar bulunuyor.

## İçindekiler
```
www/index.html          → Uygulamanın kendisi (logonuz gömülü, tek dosya)
www/manifest.json       → Uygulama adı, renk, ikon bilgisi
www/assets/icon-*.png   → Logonuzdan üretilmiş uygulama ikonları
package.json            → Android projesi için gerekli paket listesi
capacitor.config.json   → Android paketleme ayarları
```

## Önemli — Lütfen Önce Okuyun
Bu dosyalar bir web uygulamasıdır ve APK dosyasının **kendisi değildir**.
APK, bu dosyalardan Android derleme araçlarıyla (Gradle/Android Studio)
üretilir. Bunu yapmanın iki kolay yolu var. İkisi de ücretsizdir.

---

## YÖNTEM 1 — PWABuilder (En Kolay, Kod Yazmadan)

1. `www` klasörünü ücretsiz bir barındırma servisine yükleyin:
   - https://app.netlify.com/drop adresine gidin
   - `www` klasörünü tarayıcıya sürükleyip bırakın
   - Size bir link verecek (ör: `https://basak-siparis.netlify.app`)
2. https://www.pwabuilder.com adresine gidin
3. Aldığınız linki kutuya yapıştırıp "Start" deyin
4. Sonuçlar geldiğinde **Android** sekmesine tıklayın → "Generate Package"
5. İndirilen dosya doğrudan kurulabilir bir **.apk** dosyasıdır
6. Bu APK'yı personelin telefonuna aktarıp kurun (Android'de "Bilinmeyen
   kaynaklardan kuruluma izin ver" ayarını açmanız gerekebilir)

Bu yöntemde ekstra bir program kurmanıza gerek yoktur.

---

## YÖNTEM 2 — Capacitor + Android Studio (Daha Fazla Kontrol İçin)

Bilgisayarınızda Node.js ve Android Studio kurulu olmalı.

```bash
# 1) Bu klasörün içine girin
cd basak-app-project

# 2) Gerekli paketleri kurun
npm install

# 3) Android projesini oluşturun
npx cap add android

# 4) Web dosyalarını Android projesine kopyalayın
npx cap sync android

# 5) Android Studio'da açın
npx cap open android
```

Android Studio açıldıktan sonra üst menüden:
**Build → Build Bundle(s) / APK(s) → Build APK(s)**

Oluşan `.apk` dosyasını `android/app/build/outputs/apk/debug/` klasöründe
bulacaksınız. Bu dosyayı doğrudan telefona kurabilir ya da Play Store'a
yüklemek için imzalı (signed) sürüm oluşturabilirsiniz.

---

## Uygulama Hakkında Notlar

- **Varsayılan yönetici girişi:** kullanıcı adı `admin`, şifre `admin123`.
  İlk girişten sonra "Ayarlar" sekmesinden şifreyi değiştirin.
- **Veri senkronizasyonu:** Uygulama, Claude platformunun paylaşımlı
  depolama sistemini (`window.storage`) kullanarak veri paylaşır ve
  6 saniyede bir günceller. Bu, uygulamayı claude.ai üzerinde artifact
  olarak çalıştırdığınızda çalışır. Eğer uygulamayı bağımsız bir APK
  olarak dağıtırsanız, gerçek zamanlı çoklu cihaz senkronizasyonu için
  ayrı bir bulut veritabanı (ör. Firebase) entegre etmeniz gerekir —
  isterseniz bu entegrasyonu birlikte de yapabiliriz.
- **Güvenlik notu:** Bu bir prototiptir; şifreler şu an düz metin olarak
  saklanıyor. Gerçek/ticari kullanım için sunucu taraflı kimlik doğrulama
  eklenmesini öneririz.

Herhangi bir adımda takılırsanız, ekran görüntüsüyle birlikte bana
yazabilirsiniz.
