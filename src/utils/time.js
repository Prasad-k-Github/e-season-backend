// All timestamps are handled in UTC and written as 'YYYY-MM-DD HH:MM:SS' strings.
const pad = (n) => String(n).padStart(2, '0');

function nowSql(d = new Date()) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Sri Lanka calendar date (UTC+05:30) as YYYY-MM-DD. */
function todayLK(d = new Date()) {
  const lk = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return `${lk.getUTCFullYear()}-${pad(lk.getUTCMonth() + 1)}-${pad(lk.getUTCDate())}`;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function addMonths(dateStr, months) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Last valid day for a ticket that starts on `start` (inclusive of the start day). */
function ticketEndDate(start, period, durationMonths) {
  if (period === 'weekly') return addDays(start, 6);
  const months = period === 'quarterly' ? 3 : (durationMonths || 1);
  return addDays(addMonths(start, months), -1);
}

module.exports = { nowSql, todayLK, addDays, addMonths, ticketEndDate };
