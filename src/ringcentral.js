const { SDK } = require('@ringcentral/sdk');
const cfg = require('./config');
const { sleep } = require('./util');

let platform;
let lastHeavy = 0;
const HEAVY_GAP_MS = 7000; // call-log "Heavy" limit: ~10 so'rov/daq

async function login() {
  if (platform) return platform;
  const sdk = new SDK({ server: cfg.rc.server, clientId: cfg.rc.clientId, clientSecret: cfg.rc.clientSecret });
  platform = sdk.platform();
  await platform.login({ jwt: cfg.rc.jwt });
  return platform;
}

async function rcGet(url, params, heavy) {
  const p = await login();
  for (let attempt = 0; attempt < 5; attempt++) {
    if (heavy) {
      const wait = lastHeavy + HEAVY_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastHeavy = Date.now();
    }
    try {
      const r = await p.get(url, params);
      return await r.json();
    } catch (err) {
      const status = err.response?.status;
      if (status === 429) {
        const ra = Number(err.response.headers.get('retry-after')) || 60;
        console.warn(`  RC 429, ${ra}s kutaman...`);
        await sleep(ra * 1000);
        continue;
      }
      throw err;
    }
  }
  throw new Error('RingCentral: qayta urinishlar tugadi');
}

async function paged(url, baseParams, heavy) {
  const all = [];
  for (let page = 1; ; page++) {
    const j = await rcGet(url, { perPage: 100, ...baseParams, page }, heavy);
    all.push(...(j.records || []));
    if (!j.navigation?.nextPage) break;
  }
  return all;
}

/**
 * Raqam bo'yicha bizdan chiqqan call/SMS lar (arrival dan keyin).
 * Qaytaradi: { first: Date|null, last: Date|null, calls, messages }
 */
async function getContactInfo(phone, arrival) {
  const dateFrom = arrival.toISOString();
  // MUHIM: "+" query'da bo'sh joyga aylanadi va RC hech narsa topmaydi — faqat raqamlar yuboriladi
  const num = String(phone).replace(/\D/g, '');
  const callUrl = cfg.rc.accountWide
    ? '/restapi/v1.0/account/~/call-log'
    : '/restapi/v1.0/account/~/extension/~/call-log';

  const calls = (await paged(callUrl, { phoneNumber: num, dateFrom, view: 'Simple', direction: 'Outbound' }, true))
    .filter((c) => c.direction === 'Outbound' && new Date(c.startTime) >= arrival);

  let sms = [];
  if (cfg.rc.includeSms) {
    sms = (await paged('/restapi/v1.0/account/~/extension/~/message-store',
      { phoneNumber: num, dateFrom, messageType: 'SMS', direction: 'Outbound' }, false))
      .filter((m) => m.direction === 'Outbound' && new Date(m.creationTime) >= arrival);
  }

  // First/Last Contact — faqat call (SMS faqat Messages ustunida sanaladi)
  const times = [
    ...calls.map((c) => new Date(c.startTime)),
    ...(cfg.rc.smsCountsAsContact ? sms.map((m) => new Date(m.creationTime)) : []),
  ].sort((a, b) => a - b);

  return {
    first: times[0] || null,
    last: times[times.length - 1] || null,
    calls: calls.length,
    messages: sms.length,
  };
}

module.exports = { getContactInfo, login, rcGet, paged };
