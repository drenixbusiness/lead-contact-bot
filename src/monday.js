const cfg = require('./config');
const { normalizePhone, sleep } = require('./util');

const API = 'https://api.monday.com/v2';

async function gql(query, variables = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: cfg.monday.token, 'API-Version': '2024-10' },
      body: JSON.stringify({ query, variables }),
    });
    const j = await res.json().catch(() => ({ error_message: `HTTP ${res.status}` }));
    if (!j.errors && !j.error_message) return j.data;
    const msg = JSON.stringify(j.errors || j.error_message);
    // complexity / rate limit — kutib qayta urinamiz
    if (attempt < 5 && /complexity|rate|limit|429|5\d\d/i.test(msg)) { await sleep(15000 * (attempt + 1)); continue; }
    throw new Error('Monday: ' + msg);
  }
}

/** Ustunlar: har bir maydon uchun ustun nomi variantlari (birinchi bo'sh bo'lmagani olinadi). */
const CANDIDATES = {
  number: cfg.monday.cols.number,
  arrival: cfg.monday.cols.arrival,
  platform: cfg.monday.cols.platform,
  driverType: cfg.monday.cols.driverType,
  status: cfg.monday.cols.status,
  recruiter: cfg.monday.cols.recruiter,
  assigned: cfg.monday.cols.assigned,
};

async function getBoards(ids = cfg.monday.boardIds) {
  const d = await gql('query($id:[ID!]){boards(ids:$id,limit:100){id name columns{id title type} groups{id title}}}', { id: ids });
  const missing = ids.filter((id) => !d.boards.some((b) => String(b.id) === String(id)));
  if (missing.length) console.warn(`! Monday board topilmadi (token ruxsati?): ${missing.join(', ')}`);
  return d.boards;
}
const getColumns = async () => (await getBoards([cfg.monday.boardIds[0]]))[0];

const ITEM = 'id name created_at column_values{id type text value}';

async function* iterBoardItems(boardId) {
  let page = (await gql(
    `query($id:[ID!]){boards(ids:$id){items_page(limit:200){cursor items{${ITEM}}}}}`, { id: [boardId] }
  )).boards[0].items_page;
  while (true) {
    yield page.items;
    if (!page.cursor) return;
    page = (await gql(`query($c:String!){next_items_page(limit:200,cursor:$c){cursor items{${ITEM}}}}`, { c: page.cursor })).next_items_page;
  }
}

/** Ustun qiymatini Date ga (UTC) aylantiradi. */
function colDate(item, col) {
  if (!col) return null;
  if (col.type === 'creation_log') return new Date(item.created_at);
  try {
    const v = col.value ? JSON.parse(col.value) : null;
    if (v && v.date) return new Date(`${v.date}T${v.time || '00:00:00'}Z`);
  } catch { /* text ga o'tamiz */ }
  if (col.text) { const d = new Date(col.text); if (!isNaN(d)) return d; }
  return null;
}

function colPhone(col) {
  if (!col) return null;
  try {
    const v = col.value ? JSON.parse(col.value) : null;
    if (v && v.phone) return normalizePhone(v.phone);
  } catch { /* text */ }
  return normalizePhone(col.text);
}

/** "owner_operator" / "Company Driver" -> "Owner operator" / "Company driver" */
function prettyType(s) {
  const t = (s || '').replace(/_/g, ' ').trim().toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/** Board nomidan: "New leads Tim" -> { type: 'New', owner: 'Tim' }, "Follow up Tim" -> Follow-up */
function boardInfo(name) {
  const n = String(name || '').trim();
  const m = /^(new\s*leads?|follow[\s-]*ups?)\s+(.+)$/i.exec(n);
  if (!m) return { type: cfg.defaults.leadType || '', owner: '' };
  return { type: /^follow/i.test(m[1]) ? 'Follow-up' : 'New', owner: m[2].trim() };
}

/** Bitta board'ning barcha leadlari. */
async function fetchBoardLeads(board) {
  const byTitle = new Map();
  for (const col of board.columns) {
    const k = col.title.trim().toLowerCase();
    if (!byTitle.has(k)) byTitle.set(k, []);
    byTitle.get(k).push(col.id);
  }
  // har maydon uchun: nom variantlari tartibida barcha mos ustun id lari
  const ids = {};
  for (const [field, titles] of Object.entries(CANDIDATES)) {
    ids[field] = titles.flatMap((t) => byTitle.get(t.toLowerCase()) || []);
  }
  const info = boardInfo(board.name);

  const out = [];
  for await (const items of iterBoardItems(board.id)) {
    for (const it of items) {
      const cv = new Map(it.column_values.map((x) => [x.id, x]));
      const cols = (k) => ids[k].map((id) => cv.get(id)).filter(Boolean);
      const nonEmpty = (v) => (v.text || '').trim() || (v.value && v.value !== 'null' && v.value !== '{}');
      const get = (k) => cols(k).find(nonEmpty) || cols(k)[0];
      const txt = (k) => (get(k)?.text || '').trim();
      const phone = cols('number').map(colPhone).find(Boolean) || null;
      out.push({
        id: String(it.id),
        name: it.name,
        phone,                                       // faqat xotirada, Sheets'ga YOZILMAYDI
        arrival: colDate(it, get('arrival')) || new Date(it.created_at),
        assigned: colDate(it, get('assigned')),
        leadType: info.type,
        recruiter: txt('recruiter') || info.owner || cfg.defaults.recruiter,
        platform: txt('platform'),
        status: txt('status'),
        driverType: prettyType(txt('driverType')),
        board: board.name,
      });
    }
  }
  return out;
}

/** Barcha board'lardagi barcha leadlar, eng eskisi birinchi. */
async function fetchLeads() {
  const boards = await getBoards();
  const all = [];
  for (const b of boards) {
    const leads = await fetchBoardLeads(b);
    console.log(`  Monday: ${b.name} — ${leads.length} lead`);
    all.push(...leads);
  }
  return all.sort((a, b) => a.arrival - b.arrival);
}

module.exports = { fetchLeads, getColumns, getBoards, boardInfo, prettyType };
