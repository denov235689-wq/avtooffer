const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const paxta = require('./paxta');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ACCESS_CODE = process.env.ACCESS_CODE || '1212';
const WEBAPP_URL = process.env.WEBAPP_URL || '';
const PORT = process.env.PORT || 3000;

const db = new Database('data.db');
db.exec(`
CREATE TABLE IF NOT EXISTS accounts(id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT, token TEXT, enabled INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS admins(chat_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS seen(kind TEXT, ref TEXT, PRIMARY KEY(kind, ref));
CREATE TABLE IF NOT EXISTS log(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, account_id INTEGER, kind TEXT, detail TEXT, stars INTEGER DEFAULT 0, ok INTEGER DEFAULT 1);
`);

const DEFAULTS = {
  running: '1', auto_offer: '1', auto_gift: '1',
  offer_price: '100', max_gift_price: '500', daily_limit: '1000',
  limited_only: '1', target_username: '', poll_seconds: '10',
};
const get = k => (db.prepare('SELECT value FROM settings WHERE key=?').get(k) || {}).value ?? DEFAULTS[k];
const set = (k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
const isSeen = (kind, ref) => !!db.prepare('SELECT 1 FROM seen WHERE kind=? AND ref=?').get(kind, ref);
const markSeen = (kind, ref) => db.prepare('INSERT OR IGNORE INTO seen VALUES(?,?)').run(kind, ref);
const addLog = (acc, kind, detail, stars, ok) =>
  db.prepare('INSERT INTO log(ts,account_id,kind,detail,stars,ok) VALUES(?,?,?,?,?,?)').run(Date.now(), acc, kind, detail, stars, ok ? 1 : 0);
const spentToday = () => {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0);
  return db.prepare("SELECT COALESCE(SUM(stars),0) s FROM log WHERE ok=1 AND ts>=? AND kind IN ('offer','gift')").get(d.getTime()).s;
};

// ---- Kod himoyasi: 5 xato urinishdan keyin 15 daqiqa blok
const tries = new Map();
function checkCode(key, code) {
  const t = tries.get(key) || { n: 0, until: 0 };
  if (Date.now() < t.until) return 'blocked';
  if (code === ACCESS_CODE) { tries.delete(key); return 'ok'; }
  t.n++; if (t.n >= 5) { t.until = Date.now() + 15 * 60 * 1000; t.n = 0; }
  tries.set(key, t); return 'bad';
}

// ---- Telegram-mos bot API
async function tg(method, params) {
  if (!BOT_TOKEN) return null;
  try {
    const r = await fetch(`${paxta.BASE}/bot${BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params),
    });
    return (await r.json()).result;
  } catch (e) { console.error('tg xato', e.message); return null; }
}
const send = (chat, text, extra = {}) => tg('sendMessage', { chat_id: chat, text, ...extra });
const notifyAdmins = text => db.prepare('SELECT chat_id FROM admins').all().forEach(a => send(a.chat_id, text));

function statusText() {
  const n = db.prepare('SELECT COUNT(*) c FROM accounts WHERE enabled=1').get().c;
  return `📊 Holat\nIshlayapti: ${get('running') === '1' ? 'ha' : 'yo‘q'}${paxta.DRY ? ' (TEST rejim, stars sarflanmaydi)' : ''}\n` +
    `Akkauntlar: ${n}\nOffer: ${get('auto_offer') === '1' ? 'yoqilgan' : 'o‘chiq'}, narx ${get('offer_price')}⭐\n` +
    `Avto-gift: ${get('auto_gift') === '1' ? 'yoqilgan' : 'o‘chiq'}, username: ${get('target_username') || '—'}\n` +
    `Faqat limited: ${get('limited_only') === '1' ? 'ha' : 'yo‘q'}, maks. gift narxi: ${get('max_gift_price')}⭐\n` +
    `Bugun sarf: ${spentToday()}/${get('daily_limit')}⭐`;
}
const HELP = `Buyruqlar:\n/status\n/accounts\n/add nom token\n/del id\n/toggle id\n/set kalit qiymat\n/pause  /resume\n\nKalitlar: offer_price, max_gift_price, daily_limit, limited_only (1/0), target_username, auto_offer (1/0), auto_gift (1/0), poll_seconds`;

async function onMessage(msg) {
  const chat = String(msg.chat.id);
  const text = (msg.text || '').trim();
  const isAdmin = !!db.prepare('SELECT 1 FROM admins WHERE chat_id=?').get(chat);

  if (!isAdmin) {
    if (text === '/start') return send(chat, '🔐 Admin kodini kiriting:');
    const r = checkCode('chat' + chat, text);
    if (r === 'blocked') return send(chat, '⛔ Ko‘p xato urinish. 15 daqiqadan keyin urinib ko‘ring.');
    if (r === 'bad') return send(chat, '❌ Noto‘g‘ri kod.');
    db.prepare('INSERT OR IGNORE INTO admins VALUES(?)').run(chat);
    const extra = WEBAPP_URL ? { reply_markup: { inline_keyboard: [[{ text: '🚀 Mini app', web_app: { url: WEBAPP_URL } }]] } } : {};
    return send(chat, '✅ Admin kodi qabul qilindi.\n\n' + statusText() + '\n\n' + HELP, extra);
  }

  const [cmd, ...a] = text.split(/\s+/);
  switch (cmd) {
    case '/start': case '/status': return send(chat, statusText() + '\n\n' + HELP);
    case '/pause': set('running', 0); return send(chat, '⏸ To‘xtatildi');
    case '/resume': set('running', 1); return send(chat, '▶️ Ishga tushdi');
    case '/accounts': {
      const rows = db.prepare('SELECT * FROM accounts').all();
      return send(chat, rows.length ? rows.map(r => `${r.id}. ${r.label} ${r.enabled ? '🟢' : '⚪'}`).join('\n') : 'Akkaunt yo‘q. /add nom token');
    }
    case '/add':
      if (a.length < 2) return send(chat, 'Format: /add nom token');
      db.prepare('INSERT INTO accounts(label,token) VALUES(?,?)').run(a[0], a[1]);
      tg('deleteMessage', { chat_id: chat, message_id: msg.message_id }); // tokenni chatdan o'chiradi
      return send(chat, `✅ Akkaunt qo‘shildi: ${a[0]}`);
    case '/del': db.prepare('DELETE FROM accounts WHERE id=?').run(a[0]); return send(chat, '🗑 O‘chirildi');
    case '/toggle': db.prepare('UPDATE accounts SET enabled=1-enabled WHERE id=?').run(a[0]); return send(chat, '🔁 O‘zgartirildi');
    case '/set':
      if (!(a[0] in DEFAULTS) || a[0] === 'running') return send(chat, 'Noto‘g‘ri kalit.\n' + HELP);
      set(a[0], a.slice(1).join(' ')); return send(chat, `✅ ${a[0]} = ${get(a[0])}`);
    default: return send(chat, HELP);
  }
}

async function pollBot() {
  let offset = 0;
  if (!BOT_TOKEN) return console.log('BOT_TOKEN yo‘q, bot o‘chiq');
  for (;;) {
    try {
      const ups = await tg('getUpdates', { offset, timeout: 25 });
      for (const u of ups || []) { offset = u.update_id + 1; if (u.message) await onMessage(u.message); }
    } catch (e) { console.error(e.message); }
    await new Promise(r => setTimeout(r, 500));
  }
}

// ---- Avtomatik ishlar
async function doOffer(acc, l) {
  const price = +get('offer_price');
  if (spentToday() + price > +get('daily_limit')) return addLog(acc.id, 'skip', `Kunlik limit: ${l.id}`, 0, true);
  try {
    if (!paxta.DRY) await paxta.makeOffer(acc, l.id, price);
    addLog(acc.id, 'offer', `${paxta.DRY ? '[TEST] ' : ''}listing ${l.id}`, price, true);
    notifyAdmins(`💸 Offer ${price}⭐ → ${l.id} (${acc.label})${paxta.DRY ? ' [TEST]' : ''}`);
  } catch (e) { addLog(acc.id, 'offer', `${l.id}: ${e.message}`, 0, false); }
}

async function doGift(acc, g, user) {
  if (spentToday() + g.price > +get('daily_limit')) return addLog(acc.id, 'skip', `Kunlik limit: gift ${g.id}`, 0, true);
  try {
    if (!paxta.DRY) await paxta.sendGift(acc, g.id, user);
    addLog(acc.id, 'gift', `${paxta.DRY ? '[TEST] ' : ''}gift ${g.id} → @${user}`, g.price, true);
    notifyAdmins(`🎁 Gift ${g.id} (${g.price}⭐) → @${user} (${acc.label})${paxta.DRY ? ' [TEST]' : ''}`);
  } catch (e) { addLog(acc.id, 'gift', `${g.id}: ${e.message}`, 0, false); }
}

async function tick() {
  if (get('running') !== '1') return;
  const accs = db.prepare('SELECT * FROM accounts WHERE enabled=1').all();
  if (!accs.length) return;
  const main = accs[0];

  if (get('auto_offer') === '1') {
    const first = get('base_listing') !== '1';
    const list = await paxta.getMarketListings(main);
    for (const l of list) {
      if (isSeen('listing', l.id)) continue;
      markSeen('listing', l.id);
      if (!first) for (const a of accs) await doOffer(a, l); // birinchi yurishda eski e'lonlarga offer bermaydi
    }
    set('base_listing', 1);
  }

  const user = get('target_username');
  if (get('auto_gift') === '1' && user) {
    const first = get('base_gift') !== '1';
    const gifts = await paxta.getAvailableGifts(main);
    for (const g of gifts) {
      if (isSeen('gift', g.id)) continue;
      markSeen('gift', g.id);
      if (first) continue;
      if (get('limited_only') === '1' && !g.limited) continue;
      if (g.price > +get('max_gift_price')) continue;
      for (const a of accs) await doGift(a, g, user);
    }
    set('base_gift', 1);
  }
}
(async function loop() {
  try { await tick(); } catch (e) { console.error('tick', e.message); }
  setTimeout(loop, Math.max(3, +get('poll_seconds')) * 1000);
})();

// ---- Mini app API
const app = express();
app.use(express.json());
app.use(express.static('public'));
const sessions = new Map();
const auth = (req, res, next) => {
  const s = sessions.get(req.headers['x-token']);
  if (!s || s < Date.now()) return res.status(401).json({ error: 'auth' });
  next();
};
app.post('/api/login', (req, res) => {
  const r = checkCode('ip' + req.ip, String(req.body.code || ''));
  if (r === 'blocked') return res.status(429).json({ error: 'Ko‘p xato urinish, 15 daqiqa kuting' });
  if (r === 'bad') return res.status(401).json({ error: 'Noto‘g‘ri kod' });
  const t = crypto.randomBytes(24).toString('hex');
  sessions.set(t, Date.now() + 12 * 3600 * 1000);
  res.json({ token: t });
});
app.get('/api/state', auth, (req, res) => {
  const settings = {}; for (const k in DEFAULTS) settings[k] = get(k);
  res.json({
    dry: paxta.DRY, settings, spent: spentToday(),
    accounts: db.prepare('SELECT id,label,enabled FROM accounts').all(),
    log: db.prepare('SELECT * FROM log ORDER BY id DESC LIMIT 30').all(),
  });
});
app.post('/api/settings', auth, (req, res) => {
  const { key, value } = req.body;
  if (!(key in DEFAULTS)) return res.status(400).json({ error: 'kalit' });
  set(key, value); res.json({ ok: 1 });
});
app.post('/api/accounts', auth, (req, res) => {
  db.prepare('INSERT INTO accounts(label,token) VALUES(?,?)').run(req.body.label, req.body.token); res.json({ ok: 1 });
});
app.post('/api/accounts/:id/toggle', auth, (req, res) => { db.prepare('UPDATE accounts SET enabled=1-enabled WHERE id=?').run(req.params.id); res.json({ ok: 1 }); });
app.delete('/api/accounts/:id', auth, (req, res) => { db.prepare('DELETE FROM accounts WHERE id=?').run(req.params.id); res.json({ ok: 1 }); });

app.listen(PORT, () => console.log('Server:', PORT, paxta.DRY ? '(TEST rejim)' : '(JONLI rejim)'));
pollBot();
