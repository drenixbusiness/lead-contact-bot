const assert = require('assert');
const { normalizePhone, fmtDate, parseSheetDate } = require('../src/util');
const { buildRow, syncLeadsTab } = require('../src/index');
const { fmtDuration, leadPicker } = require('../src/activity');
const { callStatus, outboundIndex, contactInfo } = require('../src/rcstore');
const { boardInfo, prettyType } = require('../src/monday');

// util
assert.strictEqual(normalizePhone('(312) 555-0142'), '+13125550142');
assert.strictEqual(normalizePhone('1-312-555-0142'), '+13125550142');
assert.strictEqual(normalizePhone('123'), null);
assert.strictEqual(fmtDate(new Date('2026-11-16T15:30:00Z'), 'America/Chicago'), '2026-11-16 9:30');
assert.strictEqual(parseSheetDate('2026-11-16 9:30', 'America/Chicago').toISOString(), '2026-11-16T15:30:00.000Z');

// monday
assert.deepStrictEqual(boardInfo('New leads Tim'), { type: 'New', owner: 'Tim' });
assert.deepStrictEqual(boardInfo('Follow up Simon'), { type: 'Follow-up', owner: 'Simon' });
assert.strictEqual(prettyType('owner_operator'), 'Owner operator');

// activity
assert.strictEqual(fmtDuration(7), '7 sec');
assert.strictEqual(fmtDuration(272), '4 min 32 sec');
assert.strictEqual(fmtDuration(3725), '1 h 2 min 5 sec');
assert.strictEqual(callStatus({ direction: 'Inbound', result: 'Missed' }), 'Missed');
assert.strictEqual(callStatus({ direction: 'Inbound', result: 'Voicemail' }), 'Missed');
assert.strictEqual(callStatus({ direction: 'Inbound', result: 'Call connected' }), 'Inbound');
assert.strictEqual(callStatus({ direction: 'Outbound', result: 'No Answer' }), 'Outbound');

// bir raqam ikki board'da: yozuv vaqtigacha kelgan eng oxirgi lead
const A = { id: 'A', phone: '+1', arrival: new Date('2026-01-01') };
const B = { id: 'B', phone: '+1', arrival: new Date('2026-03-01') };
const pick = leadPicker([B, A]);
assert.strictEqual(pick('+1', Date.parse('2026-02-01')).id, 'A');
assert.strictEqual(pick('+1', Date.parse('2026-04-01')).id, 'B');
assert.strictEqual(pick('+1', Date.parse('2025-01-01')).id, 'A');

// first contact: faqat arrival dan keyingi CHIQUVCHI qo'ng'iroqlar
const st = { recs: {
  a: { k: 'Call', dir: 'Outbound', ph: '+1', t: Date.parse('2025-12-30') }, // arrival dan oldin
  b: { k: 'Call', dir: 'Outbound', ph: '+1', t: Date.parse('2026-01-05') },
  c: { k: 'Call', dir: 'Inbound', ph: '+1', t: Date.parse('2026-01-03') },
  d: { k: 'SMS', dir: 'Outbound', ph: '+1', t: Date.parse('2026-01-02') },
  e: { k: 'Call', dir: 'Outbound', ph: '+1', t: Date.parse('2026-01-09') },
} };
const ci = contactInfo(outboundIndex(st), A);
assert.strictEqual(ci.first.toISOString(), '2026-01-05T00:00:00.000Z');
assert.strictEqual(ci.last.toISOString(), '2026-01-09T00:00:00.000Z');
assert.strictEqual(ci.calls, 2);
assert.strictEqual(contactInfo(outboundIndex(st), { phone: null }), null);

// LEADS tab: yangi -> append, o'zgargan -> faqat o'sha katak; raqam yozilmaydi
const header = ['Original ID', 'Lead name', 'Arrival Date', 'First Contact Date', 'Calls', 'Status'];
const ix = new Map(header.map((h, i) => [h.toLowerCase(), i]));
const calls = { append: [], cells: [] };
const fakeTab = {
  title: 'T', col: (k) => ix.get(k.toLowerCase()),
  readAll: async () => [['A', 'John', '2026-01-01 5:00', '', '0', 'Not touched', 'N/A'], ['D', 'Ann', '2026-01-01 5:00', '2026-01-05 5:00', '2', 'Rejected']],
  appendObjects: async (o) => calls.append.push(...o),
  updateCells: async (c) => calls.cells.push(...c),
};
const lead = (id, name, status = 'Follow up') => ({ id, name, phone: '+1', arrival: new Date('2026-01-01T00:00:00Z'), status });
(async () => {
  await syncLeadsTab([lead('A', 'John'), lead('C', 'Sam'), lead('D', 'Ann', 'rejected')],
    (l) => ({ first: new Date('2026-01-05T00:00:00Z'), last: null, calls: 2 }),
    { openTab: async () => fakeTab }, {});
  assert.strictEqual(calls.append.length, 1);
  assert.strictEqual(calls.append[0]['Original ID'], 'C');
  assert.ok(!('Number' in calls.append[0]));
  const rowA = calls.cells.filter((c) => c.row === 2);
  assert.deepStrictEqual(rowA.filter((c) => c.key).map((c) => c.key).sort(), ['Calls', 'First Contact Date']);
  // status: Not touched (F) -> N/A (G) -> yangi Follow up keyingi bo'sh katakka (H = 7)
  assert.deepStrictEqual(rowA.filter((c) => c.col !== undefined), [{ row: 2, col: 7, value: 'Follow up' }]);
  // D: status o'zgarmagan (katta-kichik harf farqi hisobga olinmaydi) — hech narsa yozilmaydi
  assert.strictEqual(calls.cells.filter((c) => c.row === 3).length, 0);
  assert.strictEqual(calls.append[0]['Status'], 'Follow up');
  console.log('OK: barcha testlar o\'tdi');
})().catch((e) => { console.error(e); process.exit(1); });
