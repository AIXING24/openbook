const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const successful = payload => payload && ['OK', 'DELAYED'].includes(payload.status);
const pending = reason => ({status: 'pending', reason, finalityVerified: false});
const easternDate = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'});

export function massiveProbeRequests({ticker, from, through}) {
  if (!/^[A-Z][A-Z0-9.]{0,14}$/.test(ticker) || !validDate(from) || !validDate(through) || from > through) throw new Error('Invalid public sample request');
  return [
    {kind: 'summary', path: '/v1/open-close/' + ticker + '/' + through + '?adjusted=false'},
    {kind: 'history', path: '/v2/aggs/ticker/' + ticker + '/range/1/day/' + from + '/' + through + '?adjusted=false&sort=asc&limit=500'},
    {kind: 'splits', path: '/v3/reference/splits?ticker=' + ticker + '&execution_date.lte=' + through + '&sort=execution_date&order=desc&limit=100'},
    {kind: 'dividends', path: '/v3/reference/dividends?ticker=' + ticker + '&ex_dividend_date.gte=' + from + '&ex_dividend_date.lte=' + through + '&sort=ex_dividend_date&order=desc&limit=100'}
  ];
}

export function assessMassiveSummary(payload, {ticker, through}) {
  if (!successful(payload)) return pending('provider-status-not-successful');
  if (payload.symbol !== ticker || payload.from !== through) return pending('symbol-or-source-date-mismatch');
  if (!['open', 'high', 'low', 'close'].every(field => positive(payload[field])) || payload.low > Math.min(payload.open, payload.close) || payload.high < Math.max(payload.open, payload.close)) return pending('invalid-ohlc');
  return {status: 'valid-candidate', asOfDate: payload.from, closeField: 'close', extendedHoursNotUsed: true, adjustmentRequested: 'unadjusted', finalityVerified: false};
}

export function assessMassiveHistory(payload, {ticker, from, through}) {
  if (!successful(payload)) return pending('provider-status-not-successful');
  if (payload.ticker !== ticker || payload.adjusted !== false) return pending('symbol-or-adjustment-mismatch');
  if (!Array.isArray(payload.results) || !payload.results.length || payload.results.length > 500) return pending('empty-or-oversized-history');
  const dates = [];
  for (const row of payload.results) {
    if (!row || !Number.isSafeInteger(row.t) || row.t < 0 || row.t > 8640000000000000 || !['o', 'h', 'l', 'c'].every(field => positive(row[field])) || row.l > Math.min(row.o, row.c) || row.h < Math.max(row.o, row.c)) return pending('invalid-history-row');
    const parts = easternDate.formatToParts(new Date(row.t));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const date = values.year + '-' + values.month + '-' + values.day;
    if (date < from || date > through || (dates.length && date <= dates.at(-1))) return pending('history-date-order-or-range-invalid');
    dates.push(date);
  }
  if (payload.resultsCount !== undefined && payload.resultsCount !== dates.length) return pending('history-count-mismatch');
  return {status: 'valid-candidate', rows: dates.length, firstDate: dates[0], lastDate: dates.at(-1), hasMore: Boolean(payload.next_url), adjustmentReturned: 'unadjusted', dateBasis: 'America/New_York', finalityVerified: false, regularSessionCoverageVerified: false, calendarCompletenessVerified: false};
}

export function assessMassiveActions(payload, {ticker, from, through}, kind) {
  if (!successful(payload)) return pending('provider-status-not-successful');
  if (!['splits', 'dividends'].includes(kind) || !Array.isArray(payload.results) || payload.results.length > 100) return pending('invalid-action-response');
  const field = kind === 'splits' ? 'execution_date' : 'ex_dividend_date';
  const dates = [];
  for (const row of payload.results) {
    if (!row || row.ticker !== ticker || !validDate(row[field]) || row[field] > through || (kind === 'dividends' && row[field] < from)) return pending('action-symbol-or-date-mismatch');
    if (kind === 'splits' && (!positive(row.split_from) || !positive(row.split_to))) return pending('invalid-split-ratio');
    if (kind === 'dividends' && (!positive(row.cash_amount) || row.currency !== 'USD')) return pending('invalid-dividend-amount-or-currency');
    dates.push(row[field]);
  }
  dates.sort();
  return {status: 'valid-candidate', rows: dates.length, firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null, hasMore: Boolean(payload.next_url), eventCompletenessVerified: false, ledgerReconciled: false};
}
