export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Uniform Fisher-Yates shuffle (in place, returns the array). */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Minutes that local time in `timeZone` is ahead of UTC at the given instant. */
export function tzOffsetMinutes(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return (asUTC - date.getTime()) / 60000;
}

/** Epoch ms for midnight on the 1st of the current month in `timeZone`. */
export function startOfMonthMs(timeZone, now = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit' })
      .formatToParts(now).map((x) => [x.type, x.value]),
  );
  const naiveUTC = Date.UTC(+p.year, +p.month - 1, 1, 0, 0, 0);
  const offset = tzOffsetMinutes(new Date(naiveUTC), timeZone);
  return naiveUTC - offset * 60000;
}

/** Epoch ms for midnight (start of today) in `timeZone`. */
export function startOfDayMs(timeZone, now = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now).map((x) => [x.type, x.value]),
  );
  const naive = Date.UTC(+p.year, +p.month - 1, +p.day, 0, 0, 0);
  return naive - tzOffsetMinutes(new Date(naive), timeZone) * 60000;
}

/** [startMs, endMs) for a given calendar month (month is 1-12) in `timeZone`. */
export function monthBoundsMs(year, month, timeZone) {
  const startNaive = Date.UTC(year, month - 1, 1);
  const start = startNaive - tzOffsetMinutes(new Date(startNaive), timeZone) * 60000;
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 0 : month;
  const endNaive = Date.UTC(ny, nm, 1);
  const end = endNaive - tzOffsetMinutes(new Date(endNaive), timeZone) * 60000;
  return [start, end];
}

/** Extract the numeric deal ID from a pasted HubSpot deal URL. */
export function extractDealIdFromUrl(input) {
  const s = String(input).trim();
  // .../record/0-3/<dealId>  or  .../deal/<dealId>
  const m = s.match(/(?:record\/0-3\/|\/deal\/)(\d+)/i);
  if (m) return m[1];
  // bare id
  if (/^\d+$/.test(s)) return s;
  // last resort: last number in the string
  const all = s.match(/\d{6,}/g);
  return all ? all[all.length - 1] : null;
}
