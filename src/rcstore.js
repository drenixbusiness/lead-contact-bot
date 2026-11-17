/**
 * RingCentral tarixi (faqat lead raqamlari bilan bo'lgan call/SMS) — lokal faylda saqlanadi.
 *  - Birinchi marta: eng eski lead sanasidan bugungacha butun akkaunt call-log va har bir xodim SMS'i
 *    oyma-oy yuklanadi (to'xtab qolsa, qolgan joyidan davom etadi).
 *  - Keyin har siklda: faqat oxirgi sinxronizatsiyadan beri yangilari.
 *  - Yangi lead raqami paydo bo'lsa: o'sha raqamning eski tarixi alohida tortiladi.
 */
const fs = require('fs');
const cfg = require('./config');
const { paged } = require('./ringcentral');
const { normalizePhone, sleep } = require('./util');

const OVERLAP_MS = 6 * 3600e3;  // uzun qo'ng'iroqlar call-log'ga kech tushadi
const WINDOW_MS = 30 * 86400e3; // bootstrap oynasi — 30 kun
const MAX_PER_PHONE_BACKFILL = 150; // undan ko'p yangi raqam bo'lsa — ommaviy qayta yuklash

function load() {
  try { return JSON.parse(fs.readFileSync(cfg.rc.storeFile, 'utf8')); } catch { return null; }
}
function save(st) {
  const tmp = cfg.rc.storeFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(st));
  fs.renameSync(tmp, cfg.rc.storeFile);
}

/** Inbound qo'ng'iroq javobsiz qolgan bo'lsa — Missed. */
function callStatus(r) {
  if (r.direction === 'Inbound' && !['Call connected', 'Accepted'].includes(r.result)) return 'Missed';
  return r.direction;
}

/** Kim gaplashgan: to'g'ridan-to'g'ri nom, extension, yoki (umumiy raqamga kelgan bo'lsa) javob bergan leg. */
function hrName(r, hrSide, names) {
  if (hrSide?.name) return hrSide.name;
  if (r.extension?.id && names.get(String(r.extension.id))) return names.get(String(r.extension.id));
  for (const g of r.legs || []) {
    const n = (g.extension?.id && names.get(String(g.extension.id))) || g.to?.name;
    if (n) return n;
  }
  return '';
}

async function extensions() {
  const recs = await paged('/restapi/v1.0/account/~/extension', { perPage: 1000 }, false);
  return {
    names: new Map(recs.map((e) => [String(e.id), e.name || `ext ${e.extensionNumber}`])),
    users: recs.filter((e) => e.type === 'User' && e.status === 'Enabled'),
  };
}

function addCall(st, r, phones, names) {
  if (r.type && r.type !== 'Voice') return 0;
  const other = r.direction === 'Outbound' ? r.to : r.from;
  const ph = normalizePhone(other?.phoneNumber);
  if (!ph || !phones.has(ph)) return 0;
  const id = `call:${r.id}`;
  if (st.recs[id]) return 0;
  st.recs[id] = {
    k: 'Call', t: new Date(r.startTime).getTime(), st: callStatus(r), dir: r.direction,
    dur: r.duration ?? null, hr: hrName(r, r.direction === 'Outbound' ? r.from : r.to, names),
    ph, note: r.result || '', w: 0,
  };
  return 1;
}

function addSms(st, m, ext, phones, names) {
  const others = m.direction === 'Outbound' ? (m.to || []) : [m.from];
  const ph = others.map((o) => normalizePhone(o?.phoneNumber)).find((p) => p && phones.has(p));
  if (!ph) return 0;
  const id = `sms:${m.id}`;
  if (st.recs[id]) return 0;
  st.recs[id] = {
    k: 'SMS', t: new Date(m.creationTime).getTime(), st: m.direction, dir: m.direction,
    dur: null, hr: ext.name || names.get(String(m.extensionId)) || '', ph, note: m.subject || '', w: 0,
  };
  return 1;
}

const iso = (ms) => new Date(ms).toISOString();

/** Butun akkaunt call-log [from, to) oralig'ida, oyma-oy. */
async function bulkCalls(st, from, to, phones, names, label) {
  let added = 0;
  for (let a = from; a < to; a += WINDOW_MS) {
    const b = Math.min(a + WINDOW_MS, to);
    const recs = await paged('/restapi/v1.0/account/~/call-log',
      { dateFrom: iso(a), dateTo: iso(b), view: 'Detailed', type: 'Voice', perPage: 1000 }, true);
    for (const r of recs) added += addCall(st, r, phones, names);
    if (label) {
      st.boot.callsDoneTo = b;
      save(st);
      console.log(`  RC ${label} call: ${iso(a).slice(0, 10)} … ${iso(b).slice(0, 10)} | ${recs.length} ta call, leadlarga tegishli yangi: ${added}`);
    }
  }
  return added;
}

/** Har bir xodimning SMS'i [from, now). */
async function bulkSms(st, from, users, phones, names, label) {
  let added = 0;
  for (const ext of users) {
    if (label && st.boot.smsDone[ext.id]) continue;
    try {
      const recs = await paged(`/restapi/v1.0/account/~/extension/${ext.id}/message-store`,
        { messageType: 'SMS', dateFrom: iso(from), perPage: 1000 }, false);
      for (const m of recs) added += addSms(st, m, ext, phones, names);
      if (label) console.log(`  RC ${label} SMS: ${ext.name} — ${recs.length} ta SMS`);
    } catch (e) {
      console.warn(`  ! ${ext.name} SMS o'qilmadi: ${e.message.slice(0, 80)}`);
    }
    if (label) { st.boot.smsDone[ext.id] = 1; save(st); }
    await sleep(1300); // RC "Light" limit
  }
  return added;
}

/**
 * RC tarixini yangilaydi va store'ni qaytaradi. leads — fetchLeads() natijasi.
 */
async function syncStore(leads) {
  const phones = new Set(leads.map((l) => l.phone).filter(Boolean));
  const earliest = Math.min(...leads.map((l) => l.arrival.getTime())) - 86400e3;
  const { names, users } = await extensions();
  const now = Date.now();

  let st = load();
  if (!st) st = { boot: { from: earliest, callsDoneTo: earliest, smsDone: {}, done: false }, syncedTo: null, phones: [], recs: {} };

  // ---- 1) Birinchi to'liq yuklash (davom ettiriladigan) ----
  if (!st.boot.done) {
    console.log(`RingCentral: to'liq tarix yuklanmoqda (${iso(st.boot.from).slice(0, 10)} dan, bir martalik)...`);
    st.boot.until ||= now;
    await bulkCalls(st, st.boot.callsDoneTo, st.boot.until, phones, names, 'tarix');
    await bulkSms(st, st.boot.from, users, phones, names, 'tarix');
    st.boot.done = true;
    st.syncedTo = st.boot.until;
    st.phones = [...phones];
    save(st);
  }

  // ---- 2) Yangi lead raqamlari — eski tarixini olamiz ----
  const known = new Set(st.phones);
  const fresh = [...phones].filter((p) => !known.has(p));
  if (fresh.length) {
    const freshSet = new Set(fresh);
    console.log(`RingCentral: ${fresh.length} ta yangi lead raqami — eski tarixi olinmoqda...`);
    if (fresh.length > MAX_PER_PHONE_BACKFILL) {
      await bulkCalls(st, st.boot.from, st.syncedTo, freshSet, names, null);
      await bulkSms(st, st.boot.from, users, freshSet, names, null);
    } else {
      for (const p of fresh) {
        const recs = await paged('/restapi/v1.0/account/~/call-log',
          { phoneNumber: p.replace(/\D/g, ''), dateFrom: iso(st.boot.from), view: 'Detailed', type: 'Voice', perPage: 1000 }, true);
        for (const r of recs) addCall(st, r, freshSet, names);
      }
      // SMS: har xodim bo'yicha bitta so'rov, keyin lokal filtr
      await bulkSms(st, Math.max(st.boot.from, now - 400 * 86400e3), users, freshSet, names, null);
    }
    st.phones = [...new Set([...st.phones, ...fresh])];
    save(st);
  }

  // ---- 3) Oxirgi sinxronizatsiyadan beri yangilari ----
  const from = st.syncedTo - OVERLAP_MS;
  const all = new Set(st.phones);
  const nc = await (async () => {
    const recs = await paged('/restapi/v1.0/account/~/call-log',
      { dateFrom: iso(from), view: 'Detailed', type: 'Voice', perPage: 1000 }, true);
    let n = 0; for (const r of recs) n += addCall(st, r, all, names); return n;
  })();
  const ns = await bulkSms(st, from, users, all, names, null);
  st.syncedTo = now;
  save(st);
  console.log(`RingCentral: yangi call ${nc}, SMS ${ns} | jami saqlangan: ${Object.keys(st.recs).length}`);
  return st;
}

/** phone -> o'sish tartibida chiquvchi qo'ng'iroq vaqtlari */
function outboundIndex(st) {
  const idx = new Map();
  for (const r of Object.values(st.recs)) {
    if (r.k !== 'Call' || r.dir !== 'Outbound') continue;
    if (!idx.has(r.ph)) idx.set(r.ph, []);
    idx.get(r.ph).push(r.t);
  }
  for (const a of idx.values()) a.sort((x, y) => x - y);
  return idx;
}

/** Lead uchun: arrival dan keyingi chiquvchi qo'ng'iroqlar. */
function contactInfo(idx, lead) {
  if (!lead.phone) return null;
  const ts = (idx.get(lead.phone) || []).filter((t) => t >= lead.arrival.getTime());
  return {
    first: ts.length ? new Date(ts[0]) : null,
    last: ts.length ? new Date(ts[ts.length - 1]) : null,
    calls: ts.length,
  };
}

module.exports = { syncStore, outboundIndex, contactInfo, callStatus, hrName, save, load };
