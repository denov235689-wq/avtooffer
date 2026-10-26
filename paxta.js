// PaxtaGram API bilan ishlaydigan YAGONA joy.
// Metod nomlarini hujjatga qarab shu yerda to'g'rilang.
const BASE = process.env.PAXTA_BASE || 'https://paxta.online';
const DRY = process.env.DRY_RUN !== '0'; // DRY_RUN=0 bo'lmaguncha stars sarflanmaydi

const METHODS = {
  listings: 'getMarketListings', // TODO: hujjatdagi haqiqiy nom
  offer: 'makeOffer',            // TODO: hujjatdagi haqiqiy nom
  gifts: 'getAvailableGifts',    // Telegram bilan bir xil
  sendGift: 'sendGift',          // Telegram bilan bir xil
};

async function call(token, method, params = {}) {
  const r = await fetch(`${BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.description || 'API xato');
  return j.result;
}

// -> [{id, price}]
async function getMarketListings(acc) {
  const res = await call(acc.token, METHODS.listings);
  const arr = Array.isArray(res) ? res : res.listings || res.items || [];
  return arr.map(x => ({ id: String(x.id), price: x.price ?? x.star_count ?? 0 }));
}

async function makeOffer(acc, listingId, price) {
  return call(acc.token, METHODS.offer, { listing_id: listingId, star_count: price });
}

// -> [{id, price, limited}]
async function getAvailableGifts(acc) {
  const res = await call(acc.token, METHODS.gifts);
  const arr = Array.isArray(res) ? res : res.gifts || [];
  return arr.map(g => ({
    id: String(g.id),
    price: g.star_count ?? g.price ?? 0,
    limited: g.total_count != null || g.limited === true,
  }));
}

async function sendGift(acc, giftId, username) {
  return call(acc.token, METHODS.sendGift, { gift_id: giftId, chat_id: '@' + username.replace(/^@/, '') });
}

module.exports = { BASE, DRY, call, getMarketListings, makeOffer, getAvailableGifts, sendGift };
