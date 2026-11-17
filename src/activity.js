/**
 * "RingCentral" tab: leadlar bilan bo'lgan har bir call va SMS — alohida qator, har doim pastdan davom etadi.
 * Ma'lumot rcstore'dan olinadi; yozilganlari store'da belgilanadi (w=1), shuning uchun takrorlanmaydi.
 */
const cfg = require('./config');
const { openTab } = require('./sheets');
const { save } = require('./rcstore');
const { fmtDate } = require('./util');

const COLS = {
  type: 'Type',
  status: 'status (inbound/outbound/missed)',
  time: 'call start time/message time',
  duration: 'call duration',
  person: 'person called',
  driverId: 'driver id',
  leadName: 'lead name',
  note: 'sms/note',
};

function fmtDuration(sec) {
  if (sec == null) return '';
  // "4 min 32 sec" — Sheets buni vaqt deb o'zgartirib yubormaydi
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return [h && `${h} h`, (h || m) && `${m} min`, `${s} sec`].filter(Boolean).join(' ');
}

/** Bir raqam bir nechta board'da bo'lishi mumkin — yozuv vaqtigacha kelgan eng oxirgi lead olinadi. */
function leadPicker(leads) {
  const byPhone = new Map();
  for (const l of leads) {
    if (!l.phone) continue;
    if (!byPhone.has(l.phone)) byPhone.set(l.phone, []);
    byPhone.get(l.phone).push(l);
  }
  for (const a of byPhone.values()) a.sort((x, y) => x.arrival - y.arrival);
  return (phone, t) => {
    const a = byPhone.get(phone);
    if (!a) return null;
    let pick = a[0];
    for (const l of a) if (l.arrival.getTime() <= t) pick = l;
    return pick;
  };
}

async function writeActivity(st, leads, opts = {}) {
  const tz = cfg.bot.tz;
  const tab = await openTab(cfg.rc.activityTab);
  const missing = Object.values(COLS).filter((c) => tab.col(c) === undefined);
  if (missing.length) console.warn(`! "${tab.title}" tab'ida bu ustunlar topilmadi: ${missing.join(', ')}`);

  const pick = leadPicker(leads);
  const todo = Object.entries(st.recs).filter(([, r]) => !r.w).sort((a, b) => a[1].t - b[1].t);
  const rows = [];
  for (const [, r] of todo) {
    const lead = pick(r.ph, r.t);
    rows.push({
      [COLS.type]: r.k,
      [COLS.status]: r.st,
      [COLS.time]: fmtDate(new Date(r.t), tz),
      [COLS.duration]: r.k === 'Call' ? fmtDuration(r.dur) : '',
      [COLS.person]: r.hr,
      [COLS.driverId]: lead ? lead.id : '',
      [COLS.leadName]: lead ? lead.name : '',
      [COLS.note]: r.note,
    });
  }
  const nCalls = todo.filter(([, r]) => r.k === 'Call').length;
  console.log(`RingCentral tab: yangi ${rows.length} qator (call: ${nCalls}, sms: ${rows.length - nCalls})`);
  if (opts.dry || !rows.length) return rows.length;

  // katta hajmni bo'lib yozamiz, har bo'lakdan keyin store'ni belgilaymiz
  for (let i = 0; i < rows.length; i += 2000) {
    await tab.appendObjects(rows.slice(i, i + 2000));
    for (const [, r] of todo.slice(i, i + 2000)) r.w = 1;
    save(st);
  }
  return rows.length;
}

module.exports = { writeActivity, fmtDuration, leadPicker, COLS };
