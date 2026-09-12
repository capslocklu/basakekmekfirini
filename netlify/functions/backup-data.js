// Netlify Function: backup-data
// Firestore'daki users/products/orders/recurring_templates verilerinin
// anlık bir kopyasını (snapshot) yine Firestore içinde "backup_latest"
// belgesine yazar. Önceki yedek "backup_previous" olarak saklanır, böylece
// en az iki nesil (bugünkü + bir önceki) yedek her zaman erişilebilir olur.
// Ücretsiz bir cron servisi (örn. cron-job.org) ile günlük tetiklenir.

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

async function setFirestoreDocValue(projectId, accessToken, docPath, valueString, updatedAt) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}?updateMask.fieldPaths=value&updateMask.fieldPaths=updatedAt`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        value: { stringValue: valueString },
        updatedAt: { integerValue: String(updatedAt) }
      }
    })
  });
  const data = await resp.json();
  if (data.error) throw new Error('Firestore yazma hatası: ' + JSON.stringify(data.error));
  return data;
}

exports.handler = async () => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store, no-cache, must-revalidate' };
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    const accessToken = await getAccessToken(serviceAccount);
    const projectId = serviceAccount.project_id;

    const [usersJson, productsJson, ordersJson, recurringJson, previousLatestJson, telegramCfgJson] = await Promise.all([
      getFirestoreDocValue(projectId, accessToken, 'basak_app/users'),
      getFirestoreDocValue(projectId, accessToken, 'basak_app/products'),
      getFirestoreDocValue(projectId, accessToken, 'basak_app/orders'),
      getFirestoreDocValue(projectId, accessToken, 'basak_app/recurring_templates'),
      getFirestoreDocValue(projectId, accessToken, 'basak_app/backup_latest'),
      getFirestoreDocValue(projectId, accessToken, 'basak_app/telegram_config')
    ]);

    // Bir önceki yedeği "backup_previous" olarak sakla (varsa)
    if (previousLatestJson) {
      await setFirestoreDocValue(projectId, accessToken, 'basak_app/backup_previous', previousLatestJson, Date.now());
    }

    const snapshot = {
      users: usersJson ? JSON.parse(usersJson) : [],
      products: productsJson ? JSON.parse(productsJson) : [],
      orders: ordersJson ? JSON.parse(ordersJson) : [],
      recurringTemplates: recurringJson ? JSON.parse(recurringJson) : []
    };
    const backedUpAt = Date.now();
    const newBackup = { snapshot, backedUpAt };

    await setFirestoreDocValue(projectId, accessToken, 'basak_app/backup_latest', JSON.stringify(newBackup), backedUpAt);

    // Yedekleme başarılı olduğunda Telegram'a kısa bir onay mesajı gönder
    // (bu adım isteğe bağlıdır; bot ayarlı değilse veya gönderim başarısız
    // olursa yedeklemenin kendisi yine de başarılı sayılır)
    let botToken = process.env.TELEGRAM_BOT_TOKEN;
    let chatId = process.env.TELEGRAM_CHAT_ID;
    if (telegramCfgJson) {
      try {
        const cfg = JSON.parse(telegramCfgJson);
        if (cfg.botToken) botToken = cfg.botToken;
        if (cfg.chatId) chatId = cfg.chatId;
      } catch (e) { /* bozuksa ortam değişkenleri kullanılır */ }
    }
    if (botToken && chatId) {
      const tarih = new Date(backedUpAt).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
      const confirmText = `✅ *Yedekleme tamamlandı*\n🕐 ${tarih}\n\n👥 ${snapshot.users.length} kullanıcı\n📦 ${snapshot.products.length} ürün\n📋 ${snapshot.orders.length} sipariş\n🔁 ${snapshot.recurringTemplates.length} şablon`;
      try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: confirmText, parse_mode: 'Markdown' })
        });
      } catch (e) { /* Telegram bildirimi başarısız olsa bile yedekleme geçerlidir */ }
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        ok: true,
        backedUpAt,
        counts: {
          users: snapshot.users.length,
          products: snapshot.products.length,
          orders: snapshot.orders.length,
          recurringTemplates: snapshot.recurringTemplates.length
        }
      })
    };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
