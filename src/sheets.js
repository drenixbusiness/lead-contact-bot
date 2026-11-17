const { google } = require('googleapis');
const cfg = require('./config');

// LEADS (NEW) uchun ustunlar. Sheet'da tartib qanday bo'lsa ham — sarlavha NOMI bo'yicha yoziladi.
const HEADERS = [
  'Original ID', 'Lead name', 'Arrival Date', 'Assigned Date', 'Lead Type',
  'Recruiter', 'Platform', 'First Contact Date', 'Last Contact Date', 'Driver Type',
  'Calls', 'Messages', 'Status',
];
const FORBIDDEN = new Set(['number']); // telefon raqami HECH QACHON yozilmaydi

let api;
function sheetsApi() {
  if (!api) {
    const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
    const auth = cfg.sheets.clientEmail && cfg.sheets.privateKey
      ? new google.auth.JWT({ email: cfg.sheets.clientEmail, key: cfg.sheets.privateKey, scopes })
      : new google.auth.GoogleAuth({ keyFile: cfg.sheets.keyFile, scopes });
    api = google.sheets({ version: 'v4', auth });
  }
  return api;
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const q = (title) => `'${title.replace(/'/g, "''")}'`;
function colLetter(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

let titlesCache;
/** Tab nomini topadi: avval aynan mos, keyin katta-kichik harfga qaramay. */
async function resolveTab(name) {
  if (!titlesCache) {
    const r = await sheetsApi().spreadsheets.get({ spreadsheetId: cfg.sheets.sheetId, fields: 'sheets.properties.title' });
    titlesCache = r.data.sheets.map((s) => s.properties.title);
  }
  const hit = titlesCache.find((t) => t === name) || titlesCache.find((t) => norm(t) === norm(name));
  if (!hit) throw new Error(`Sheets'da "${name}" tab topilmadi. Bor: ${titlesCache.join(', ')}`);
  return hit;
}

/** Tab bilan ishlash: sarlavhani o'qiydi va obyekt -> qator xaritasini beradi. */
async function openTab(name) {
  const title = await resolveTab(name);
  const r = await sheetsApi().spreadsheets.values.get({ spreadsheetId: cfg.sheets.sheetId, range: `${q(title)}!1:1` });
  const header = (r.data.values && r.data.values[0]) || [];
  const idx = new Map(header.map((h, i) => [norm(h), i]));
  const width = header.length;

  /** obj kalitlari = sarlavha nomlari. Sheet'da yo'q kalitlar tashlab yuboriladi. */
  const toRow = (obj) => {
    const row = new Array(width).fill('');
    for (const [k, v] of Object.entries(obj)) {
      const i = idx.get(norm(k));
      if (i === undefined || FORBIDDEN.has(norm(k))) continue;
      row[i] = v ?? '';
    }
    return row;
  };

  return {
    title, header, idx, width,
    col: (name) => idx.get(norm(name)),
    toRow,
    async readAll() {
      const res = await sheetsApi().spreadsheets.values.get({
        spreadsheetId: cfg.sheets.sheetId, range: `${q(title)}!A2:${colLetter(Math.max(width, 1) - 1)}`,
        valueRenderOption: 'FORMATTED_VALUE',
      });
      return res.data.values || [];
    },
    /** Har doim ENG OXIRGI to'ldirilgan qatordan keyin yozadi (Google'ning "append" taxminiga ishonmaymiz). */
    async appendObjects(objs) {
      if (!objs.length) return;
      const s = sheetsApi();
      const used = await s.spreadsheets.values.get({ spreadsheetId: cfg.sheets.sheetId, range: `${q(title)}!A:${colLetter(Math.max(width, 1) - 1)}` });
      const vals = used.data.values || [];
      let last = vals.length; // oxirgi bo'sh bo'lmagan qator raqami
      while (last > 0 && !(vals[last - 1] || []).some((c) => String(c).trim())) last--;
      const start = Math.max(last, 1) + 1;
      const end = start + objs.length - 1;

      // grid yetmasa — qator qo'shamiz
      const meta = await s.spreadsheets.get({ spreadsheetId: cfg.sheets.sheetId, fields: 'sheets.properties(sheetId,title,gridProperties.rowCount)' });
      const p = meta.data.sheets.find((x) => x.properties.title === title).properties;
      if (p.gridProperties.rowCount < end) {
        await s.spreadsheets.batchUpdate({
          spreadsheetId: cfg.sheets.sheetId,
          requestBody: { requests: [{ appendDimension: { sheetId: p.sheetId, dimension: 'ROWS', length: end - p.gridProperties.rowCount + 100 } }] },
        });
      }
      await s.spreadsheets.values.update({
        spreadsheetId: cfg.sheets.sheetId, range: `${q(title)}!A${start}`,
        valueInputOption: 'USER_ENTERED', requestBody: { values: objs.map(toRow) },
      });
    },
    /** cells = [{ row, key, value }] — bir nechta so'rovda, 1000 tadan. */
    async updateCells(cells) {
      for (let i = 0; i < cells.length; i += 1000) {
        const data = [];
        for (const c of cells.slice(i, i + 1000)) {
          const ci = idx.get(norm(c.key));
          if (ci === undefined || FORBIDDEN.has(norm(c.key))) continue;
          data.push({ range: `${q(title)}!${colLetter(ci)}${c.row}`, values: [[c.value ?? '']] });
        }
        if (data.length) {
          await sheetsApi().spreadsheets.values.batchUpdate({
            spreadsheetId: cfg.sheets.sheetId, requestBody: { valueInputOption: 'USER_ENTERED', data },
          });
        }
      }
    },
    /** Faqat obj'dagi ustunlarni yangilaydi (boshqa ustunlarga tegmaydi). */
    async updateObject(rowNum, obj) {
      const data = [];
      for (const [k, v] of Object.entries(obj)) {
        const i = idx.get(norm(k));
        if (i === undefined || FORBIDDEN.has(norm(k))) continue;
        data.push({ range: `${q(title)}!${colLetter(i)}${rowNum}`, values: [[v ?? '']] });
      }
      if (!data.length) return;
      await sheetsApi().spreadsheets.values.batchUpdate({
        spreadsheetId: cfg.sheets.sheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data },
      });
    },
  };
}

// ---------- LEADS (NEW) ----------
let leadsTab;
const leads = async () => (leadsTab ||= await openTab(cfg.sheets.tab));

async function ensureHeader() {
  const t = await leads();
  if (!t.width) {
    await sheetsApi().spreadsheets.values.update({
      spreadsheetId: cfg.sheets.sheetId, range: `${q(t.title)}!A1`,
      valueInputOption: 'RAW', requestBody: { values: [HEADERS] },
    });
    leadsTab = null;
    return;
  }
  const missing = HEADERS.filter((h) => t.col(h) === undefined);
  if (missing.length) console.warn(`! "${t.title}" tab'ida bu ustunlar yo'q, yozilmaydi: ${missing.join(', ')}`);
}

/** Mavjud qatorlar: Map(originalId -> { row, firstContact, arrival }) */
async function readExisting() {
  const t = await leads();
  const cId = t.col('Original ID'), cFirst = t.col('First Contact Date'), cArr = t.col('Arrival Date');
  const map = new Map();
  (await t.readAll()).forEach((v, i) => {
    const id = v[cId];
    if (id) map.set(String(id), { row: i + 2, arrival: v[cArr] || '', firstContact: v[cFirst] || '' });
  });
  return map;
}

async function appendRow(obj) { await (await leads()).appendObjects([obj]); }

/** Mavjud qatorni yangilaydi (Original ID ga tegilmaydi). */
async function updateRow(rowNum, obj) {
  const { 'Original ID': _id, ...rest } = obj;
  await (await leads()).updateObject(rowNum, rest);
}

module.exports = { HEADERS, openTab, ensureHeader, readExisting, appendRow, updateRow };
