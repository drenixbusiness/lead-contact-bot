const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Telefonni E.164 ga keltiradi (AQSh default). Yaroqsiz bo'lsa null. */
function normalizePhone(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const digits = s.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (s.startsWith('+')) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return '+' + digits;
}

const maskPhone = (p) => (p ? '***' + p.slice(-4) : 'raqam yo\'q');

/** Date -> "YYYY-MM-DD H:mm" berilgan vaqt zonasida (LEADS (NEW) dagi format). */
function fmtDate(d, tz) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return '';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(dt).map((x) => [x.type, x.value])
  );
  const hh = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day} ${Number(hh)}:${p.minute}`;
}

/** Sheets'dagi "YYYY-MM-DD H:mm" ni (tz bo'yicha) Date ga qaytaradi — faqat taxminiy filtr uchun. */
function parseSheetDate(s, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(s || '').trim());
  if (!m) return null;
  const [, yr, mo, da, hh = '0', mi = '00', ss = '00'] = m;
  const guess = new Date(Date.UTC(+yr, +mo - 1, +da, +hh, +mi, +ss));
  const shown = parseWallClock(fmtDate(guess, tz));
  return new Date(guess.getTime() - (shown - guess.getTime()));
}
function parseWallClock(f) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2})$/.exec(f);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

function fmtDelay(ms) {
  if (ms == null) return '—';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} daq`;
  const h = Math.floor(m / 60);
  return `${h} soat ${m % 60} daq`;
}

module.exports = { sleep, normalizePhone, maskPhone, fmtDate, parseSheetDate, fmtDelay };
