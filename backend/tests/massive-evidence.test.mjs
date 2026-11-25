import test from 'node:test';
import assert from 'node:assert/strict';
import {massiveProbeRequests, assessMassiveSummary, assessMassiveHistory, assessMassiveActions} from '../massive-evidence.mjs';

const context = {ticker: 'NVDA', from: '2025-11-25', through: '2026-11-24'};
const summary = () => ({status: 'OK', symbol: 'NVDA', from: context.through, open: 10, high: 12, low: 9, close: 11, preMarket: 40, afterHours: 50});
const row = timestamp => ({t: Date.parse(timestamp), o: 10, h: 12, l: 9, c: 11});
const history = () => ({status: 'OK', ticker: 'NVDA', adjusted: false, resultsCount: 2, results: [row('2026-11-23T05:00:00Z'), row('2026-11-24T05:00:00Z')]});

test('public sample requests have explicit raw mode and no credential or arbitrary host', () => {
  const requests = massiveProbeRequests(context);
  assert.equal(requests.length, 4);
  assert.ok(requests.slice(0, 2).every(request => request.path.includes('adjusted=false')));
  assert.ok(requests.every(request => request.path.startsWith('/') && !request.path.includes('apiKey')));
  for (const input of [{...context, ticker: 'https://bad.invalid'}, {...context, from: '2026-02-30'}, {...context, from: '2027-01-01'}]) assert.throws(() => massiveProbeRequests(input));
});

test('summary excludes extended-hours values without asserting finality', () => {
  const result = assessMassiveSummary(summary(), context);
  assert.equal(result.status, 'valid-candidate');
  assert.equal(result.closeField, 'close');
  assert.equal(result.finalityVerified, false);
  assert.equal(result.extendedHoursNotUsed, true);
});

test('summary rejects status, ticker, date and malformed OHLC', () => {
  for (const change of [{status: 'NOT_AUTHORIZED'}, {symbol: 'QQQ'}, {from: '2026-11-23'}, {close: '11'}, {close: Infinity}, {close: 0}, {high: 10}, {low: 12}]) assert.equal(assessMassiveSummary({...summary(), ...change}, context).status, 'pending');
});

test('history requires explicit unadjusted data and reports source-local dates', () => {
  const result = assessMassiveHistory(history(), context);
  assert.equal(result.status, 'valid-candidate');
  assert.equal(result.rows, 2);
  assert.equal(result.lastDate, '2026-11-24');
  assert.equal(result.finalityVerified, false);
  assert.equal(result.regularSessionCoverageVerified, false);
});

test('history rejects adjusted, duplicate, unsorted, missing or oversized bars', () => {
  const value = history();
  for (const change of [{adjusted: true}, {adjusted: undefined}, {ticker: 'QQQ'}, {results: []}, {results: Array(501).fill(value.results[0])}, {results: [value.results[0], value.results[0]]}, {results: [...value.results].reverse()}, {resultsCount: 3}]) assert.equal(assessMassiveHistory({...value, ...change}, context).status, 'pending');
});

test('history uses New York date across UTC midnight and rejects future rows', () => {
  const value = history();
  value.results = [row('2026-11-25T01:00:00Z')];
  value.resultsCount = 1;
  assert.equal(assessMassiveHistory(value, context).lastDate, '2026-11-24');
  value.results[0].t = Date.parse('2026-11-25T05:00:00Z');
  assert.equal(assessMassiveHistory(value, context).status, 'pending');
});

test('history rejects invalid prices and timestamps without exposing provider fields', () => {
  for (const change of [{t: NaN}, {t: -1}, {t: 8640000000000001}, {c: '11'}, {l: 12}, {h: 10}]) {
    const value = history();
    value.results[0] = {...value.results[0], ...change};
    assert.equal(assessMassiveHistory(value, context).status, 'pending');
  }
});

test('action access does not prove complete history or ledger reconciliation', () => {
  const split = {ticker: 'NVDA', execution_date: '2024-06-10', split_from: 1, split_to: 10};
  const result = assessMassiveActions({status: 'OK', results: [split], next_url: 'https://api.massive.com/next'}, context, 'splits');
  assert.equal(result.status, 'valid-candidate');
  assert.equal(result.hasMore, true);
  assert.equal(result.eventCompletenessVerified, false);
  assert.equal(result.ledgerReconciled, false);
  assert.equal(assessMassiveActions({status: 'OK', results: []}, context, 'splits').rows, 0);
});

test('actions reject invalid dates, tickers, split factors and dividend currency', () => {
  for (const split of [{ticker: 'QQQ', execution_date: '2024-06-10', split_from: 1, split_to: 10}, {ticker: 'NVDA', execution_date: '2026-02-30', split_from: 1, split_to: 10}, {ticker: 'NVDA', execution_date: '2024-06-10', split_from: 0, split_to: 10}]) assert.equal(assessMassiveActions({status: 'OK', results: [split]}, context, 'splits').status, 'pending');
  const dividend = {ticker: 'NVDA', ex_dividend_date: '2026-09-11', cash_amount: 0.01, currency: 'USD'};
  assert.equal(assessMassiveActions({status: 'OK', results: [dividend]}, context, 'dividends').status, 'valid-candidate');
  assert.equal(assessMassiveActions({status: 'OK', results: [{...dividend, currency: 'HKD'}]}, context, 'dividends').status, 'pending');
  assert.equal(assessMassiveActions({status: 'OK', results: [{...dividend, ex_dividend_date: '2025-01-01'}]}, context, 'dividends').status, 'pending');
  assert.equal(assessMassiveActions({status: 'OK', results: [null]}, context, 'splits').status, 'pending');
});
