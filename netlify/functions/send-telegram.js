// Netlify Function: send-telegram
// Bu fonksiyon Firestore'dan sipariş verisini çeker, Telegram grubuna
// biçimlendirilmiş bir mesaj olarak gönderir. Hem uygulamadaki "Telegram'a
// Gönder" butonundan hem de dışarıdan (ücretsiz bir cron servisinden)
// tetiklenebilir. Bot token'ı ve servis hesabı bilgileri hiçbir zaman
// tarayıcıya gönderilmez, yalnızca Netlify'ın sunucu tarafında kalır.

const crypto = require('crypto');

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(serviceAccount) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  const encHeader = base64url(Buffer.from(JSON.stringify(header)));
  const encClaim = base64url(Buffer.from(JSON.stringify(claimSet)));
  const signInput = `${encHeader}.${encClaim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signInput);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key);
  const jwt = `${signInput}.${base64url(signature)}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('Google auth başarısız: ' + JSON.stringify(data));
  return data.access_token;
}

async function getFirestoreDocValue(projectId, accessToken, docPath) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await resp.json();
  if (data.fields && data.fields.value && data.fields.value.stringValue) {
    return data.fields.value.stringValue;
  }
  return null;
}

function dateStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function formatDateLong(d) {
  const [y, m, day] = d.split('-');
  const aylar = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  const gunler = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
  const dateObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(day));
  return `${parseInt(day)} ${aylar[parseInt(m) - 1]} ${y} ${gunler[dateObj.getDay()]}`;
}

function escapeMd(s) {
  // Telegram legacy Markdown'da sorun çıkarabilecek karakterleri temizle
  return (s || '').replace(/[_*[\]`]/g, '');
}

exports.handler = async (event) => {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    const accessToken = await getAccessToken(serviceAccount);

    // Telegram ayarlarını ve sipariş verisini AYNI ANDA çekiyoruz (art arda değil),
    // bu da toplam bekleme süresini neredeyse yarıya indiriyor.
    const [cfgJson, ordersJson] = await Promise.all([
      getFirestoreDocValue(serviceAccount.project_id, accessToken, 'basak_app/telegram_config').catch(() => null),
      getFirestoreDocValue(serviceAccount.project_id, accessToken, 'basak_app/orders')
    ]);

    let botToken = process.env.TELEGRAM_BOT_TOKEN;
    let chatId = process.env.TELEGRAM_CHAT_ID;
    if (cfgJson) {
      try {
        const cfg = JSON.parse(cfgJson);
        if (cfg.botToken) botToken = cfg.botToken;
        if (cfg.chatId) chatId = cfg.chatId;
      } catch (e) { /* bozuk kayıt varsa ortam değişkenleri kullanılır */ }
    }
    if (!botToken || !chatId) throw new Error('TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID eksik');

    const type = (event.queryStringParameters && event.queryStringParameters.type) || 'tomorrow';
    const orders = ordersJson ? JSON.parse(ordersJson) : [];

    let targetDate, label;
    if (type === 'today') { targetDate = dateStr(0); label = 'Bugün'; }
    else if (type === 'daytwo') { targetDate = dateStr(2); label = 'Öbür Gün'; }
    else { targetDate = dateStr(1); label = 'Yarın'; }

    const list = orders
      .filter(o => o.date === targetDate && !o.hidden && !o.deleted)
      .sort((a, b) => a.customer.localeCompare(b.customer, 'tr'));

    let text;
    if (list.length === 0) {
      text = `🌾 *Başak Ekmek Fırını*\n📅 ${label} — ${formatDateLong(targetDate)}\n\nHenüz sipariş yok.`;
    } else {
      text = `🌾 *Başak Ekmek Fırını*\n📅 ${label} — ${formatDateLong(targetDate)}\n\n`;
      list.forEach((o, i) => {
        const itemsStr = o.items.map(it => `${escapeMd(it.name)} x${it.qty}`).join(', ');
        text += `${i + 1}. *${escapeMd(o.customer)}* — ${itemsStr}`;
        if (o.address) text += `\n   📍 ${escapeMd(o.address)}`;
        text += '\n\n';
      });
      const totals = {};
      list.forEach(o => o.items.forEach(it => { totals[it.name] = (totals[it.name] || 0) + it.qty; }));
      text += `—\n*Toplam: ${list.length} sipariş*\n`;
      Object.entries(totals).sort((a, b) => b[1] - a[1]).forEach(([name, qty]) => {
        text += `${escapeMd(name)}: ${qty} adet\n`;
      });
    }

    const tgResp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
    const tgData = await tgResp.json();
    if (!tgData.ok) throw new Error('Telegram hata: ' + JSON.stringify(tgData));

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, orderCount: list.length, date: targetDate }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
