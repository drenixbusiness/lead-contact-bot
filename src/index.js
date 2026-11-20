const cfg = require('./config');
const { fmtDate, sleep } = require('./util');

/** LEADS (NEW) qatori — kalitlar = sheet sarlavhalari (tartib sheet'dan olinadi). Raqam yozilmaydi. */
function buildRow(lead, info, tz) {
  return {
    'Original ID': lead.id,
    'Lead name': lead.name,
    'Arrival Date': fmtDate(lead.arrival, tz),
    'Assigned Date': fmtDate(lead.assigned, tz),
    'Lead Type': lead.leadType,
    'Recruiter': lead.recruiter,
    'Platform': lead.platform,
    'First Contact Date': fmtDate(info?.first, tz),
    'Last Contact Date': fmtDate(info?.last, tz),
    'Driver Type': lead.driverType,
    'Calls': info ? info.calls : '',
    'Messages': '',
    'Status': lead.status,
  };
}

/**
 * LEADS (NEW): yangi leadlar pastga qo'shiladi, mavjudlarining faqat o'zgargan kataklari yangilanadi.
 * deps.sheets.openTab, deps.contact(lead) -> info
 */
async function syncLeadsTab(leads, contact, sheets, opts = {}) {
  const tz = cfg.bot.tz;
  const tab = await sheets.openTab(cfg.sheets.tab);
  const cId = tab.col('Original ID');
  if (cId === undefined) throw new Error(`"${tab.title}" tab'ida "Original ID" ustuni yo'q`);

  const cStatus = tab.col('Status');
  // Status tarixi: Status ustunidan o'ngga — har o'zgarishda keyingi bo'sh katak
  const STATUS_HISTORY = 40;
  const existing = new Map();
  (await tab.readAll(STATUS_HISTORY)).forEach((v, i) => { if (v[cId]) existing.set(String(v[cId]), { row: i + 2, v }); });
  let statusChanges = 0;

  const appends = [];
  const cells = [];
  for (const lead of leads) {
    const obj = buildRow(lead, contact(lead), tz);
    const ex = existing.get(lead.id);
    if (!ex) { appends.push(obj); continue; }
    if (cStatus !== undefined && lead.status) {
      const hist = (ex.v.slice(cStatus) || []).map((x) => String(x ?? '').trim());
      let last = hist.length - 1;
      while (last >= 0 && !hist[last]) last--;
      const current = last >= 0 ? hist[last] : '';
      if (current.toLowerCase() !== lead.status.trim().toLowerCase()) {
        cells.push({ row: ex.row, col: cStatus + last + 1, value: lead.status });
        statusChanges++;
      }
    }
    for (const [k, val] of Object.entries(obj)) {
      if (k === 'Original ID' || k === 'Status') continue;
      const c = tab.col(k);
      if (c === undefined) continue;
      if (String(ex.v[c] ?? '').trim() !== String(val ?? '').trim()) cells.push({ row: ex.row, key: k, value: val });
    }
  }
  const changedRows = new Set(cells.map((c) => c.row)).size;
  console.log(`LEADS tab: jami ${leads.length} lead | yangi qo'shiladi: ${appends.length} | yangilanadi: ${changedRows} qator | status o'zgardi: ${statusChanges}`);
  if (opts.dry) return { appends: appends.length, updated: changedRows };

  await tab.updateCells(cells);
  for (let i = 0; i < appends.length; i += 2000) await tab.appendObjects(appends.slice(i, i + 2000));
  return { appends: appends.length, updated: changedRows };
}

/** Bitta sikl: Monday (12 board) -> RingCentral tarixi -> "RingCentral" tab -> LEADS (NEW). */
async function cycle(opts = {}) {
  const t0 = Date.now();
  const { fetchLeads } = require('./monday');
  const { syncStore, outboundIndex, contactInfo } = require('./rcstore');
  const { writeActivity } = require('./activity');
  const sheets = require('./sheets');

  console.log(`\n=== ${new Date().toISOString()} — sikl boshlandi ===`);
  const leads = await fetchLeads();
  const st = await syncStore(leads);
  if (!opts.leadsOnly) await writeActivity(st, leads, opts);
  if (!opts.activityOnly) {
    const idx = outboundIndex(st);
    await syncLeadsTab(leads, (l) => contactInfo(idx, l), sheets, opts);
  }
  console.log(`=== sikl tugadi (${Math.round((Date.now() - t0) / 1000)} s) ===`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'run';
  const flag = (k) => args.includes(`--${k}`);

  if (cmd === 'inspect') {
    const { getBoards } = require('./monday');
    for (const b of await getBoards()) {
      console.log(`\nBoard ${b.id}: ${b.name}`);
      b.columns.forEach((c) => console.log(`  ${c.id.padEnd(24)} ${c.type.padEnd(14)} ${c.title}`));
    }
    return;
  }

  const opts = { dry: flag('dry'), activityOnly: cmd === 'activity', leadsOnly: cmd === 'leads' };
  if (flag('watch')) {
    while (true) {
      try { await cycle(opts); } catch (e) { console.error('Xato:', e.stack || e.message); }
      await sleep(cfg.bot.pollMinutes * 60e3);
    }
  } else {
    await cycle(opts);
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { buildRow, syncLeadsTab, cycle };
