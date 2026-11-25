import {assessValuationEvidence, marketCloseAt} from './market-evidence.mjs';
import {ecbReferenceRates} from './ecb-fx.mjs';
import {massiveProbeRequests, assessMassiveSummary, assessMassiveHistory} from './massive-evidence.mjs';

const context = {ticker: 'NVDA', from: '2025-11-25', through: '2026-11-24'};
const actions = new Map(massiveProbeRequests(context).filter(request => ['summary', 'history'].includes(request.kind)).map(request => [request.kind, request.path]));
const fxSource = 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD+CNY+HKD.EUR.SP00.A?startPeriod=2026-11-24&endPeriod=2026-11-24&format=csvdata';
const respond = (body, status = 200) => Response.json(body, {status, headers: {'cache-control': 'no-store'}});
const version = 'market-validation v0.3.6';

export function mockMarketEvidence(count) {
  if (![5, 50].includes(count)) throw new Error('Unsupported isolated fixture count');
  const date = context.through, now = Date.parse('2026-11-25T00:30:00Z');
  const csv = 'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS\n' + Object.entries({CNY: 7.8, USD: 1.2, HKD: 9.6}).map(([currency, value]) => 'EXR.D.' + currency + '.EUR.SP00.A,D,' + currency + ',EUR,SP00,A,' + date + ',' + value + ',A').join('\n');
  const markets = [['us', 'USD', '16:00', '21:00'], ['hk', 'HKD', '16:10', '08:10'], ['sh', 'CNY', '15:00', '07:00'], ['sz', 'CNY', '15:00', '07:00']];
  const input = {date, now, dateBasis: 'market-local', approvedProviders: {'isolated-fixture': true, 'ecb-reference': true}, fxDate: date, fx: ecbReferenceRates(csv, {date, observedAt: now}), instruments: [], sessions: [], prices: [], actionChecks: []};
  for (let index = 0; index < count; index++) {
    const [mkt, cur, closeTime, utcTime] = markets[index % markets.length], tc = mkt + 'FIXTURE' + index;
    const closeAt = Date.parse(date + 'T' + utcTime + ':00Z');
    input.instruments.push({tc, mkt, cur, historyFrom: '2026-11-01'});
    input.prices.push({tc, date, px: 100, currency: cur, provider: 'isolated-fixture', adjustment: 'unadjusted', session: 'regular', status: 'final', closeAt, observedAt: now, sourceUrl: 'https://fixture.invalid/price'});
    input.actionChecks.push({tc, state: 'reconciled', unresolved: false, fromDate: '2026-11-01', throughDate: date, sourceUrl: 'https://fixture.invalid/actions'});
    if (index < markets.length) input.sessions.push({mkt, date, open: true, status: 'verified', priceDate: date, closeTime, closeMechanism: mkt === 'hk' ? 'CAS' : undefined, readyAt: closeAt + 900000, sourceUrl: 'https://fixture.invalid/calendar'});
  }
  return input;
}

export async function boundedSourceText(response, limit) {
  if (!response.body || Number(response.headers.get('content-length')) > limit) throw new Error('Source body exceeds limit');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new Error('Source body exceeds limit');
      chunks.push(chunk.value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    throw new Error('Source body unavailable');
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  return new TextDecoder().decode(bytes);
}

function authorized(request, env, now) {
  const start = Date.parse(env.VALIDATION_STARTED_AT), end = Date.parse(env.VALIDATION_EXPIRES_AT);
  if (env.VALIDATION_MODE !== 'isolated-market-only' || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 3600000 || now < start - 60000 || now >= end) return false;
  const token = env.VALIDATION_TOKEN, supplied = request.headers.get('authorization');
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || typeof supplied !== 'string' || supplied.length !== token.length + 7) return false;
  const expected = 'Bearer ' + token;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  return difference === 0;
}

export function marketValidation({fetchSource = fetch, clock = Date.now} = {}) {
  return {async fetch(request, env) {
    const now = clock();
    if (!authorized(request, env, now)) return respond({error: 'Isolated validation authorization required'}, 401);
    if (request.method !== 'GET') return respond({error: 'Read-only validation'}, 405);
    const url = new URL(request.url), kind = url.searchParams.get('kind');
    if (url.pathname === '/validation/status') return respond({version, isolated: true, databaseBound: false, realLedgerWrites: false, cronEnabled: false, sourceApproved: false});
    if (url.pathname !== '/validation/market') return respond({error: 'Unknown isolated validation route'}, 404);
    let sourcePhase = 'none';
    try {
      if (kind === 'evidence-5' || kind === 'evidence-50') {
        const count = kind === 'evidence-5' ? 5 : 50, result = assessValuationEvidence(mockMarketEvidence(count));
        return respond({version, kind, synthetic: true, status: result.status, instruments: count, issues: result.issues?.length ?? 0, realLedgerWrites: false});
      }
      if (kind === 'today-readiness') {
        const date = '2026-11-25', closeAt = marketCloseAt(date, 'us', '16:00');
        return respond({version, kind, date, observedAt: now, closeAt, status: now < closeAt ? 'pending' : 'requires-source-observation', reason: now < closeAt ? 'regular-session-not-closed' : 'readiness-not-established', upstreamRequests: 0, finalityVerified: false});
      }
      if (kind === 'fx') {
        sourcePhase = 'fetch';
        const response = await fetchSource(fxSource, {headers: {accept: 'text/csv'}, redirect: 'manual', signal: AbortSignal.timeout(20000)});
        if (!response.ok) {await response.body?.cancel(); return respond({version, kind, status: 'pending', upstreamHttpStatus: response.status});}
        sourcePhase = 'read';
        const text = await boundedSourceText(response, 24576);
        sourcePhase = 'parse';
        const result = ecbReferenceRates(text, {date: context.through, observedAt: now});
        return respond({version, kind, status: 'valid-candidate', asOfDate: result.asOfDate, basis: result.basis, isExecutionRate: false, currencies: Object.keys(result.rates), realLedgerWrites: false});
      }
      if (!actions.has(kind)) return respond({error: 'Unsupported isolated validation kind'}, 400);
      if (typeof env.MASSIVE_API_KEY !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(env.MASSIVE_API_KEY)) return respond({error: 'Source secret unavailable'}, 503);
      sourcePhase = 'fetch';
      const response = await fetchSource('https://api.massive.com' + actions.get(kind), {headers: {authorization: 'Bearer ' + env.MASSIVE_API_KEY, accept: 'application/json'}, redirect: 'manual', signal: AbortSignal.timeout(20000)});
      if (!response.ok) {await response.body?.cancel(); return respond({version, kind, status: 'pending', upstreamHttpStatus: response.status});}
      sourcePhase = 'read';
      const text = await boundedSourceText(response, 262144);
      sourcePhase = 'parse';
      const payload = JSON.parse(text);
      const result = kind === 'summary' ? assessMassiveSummary(payload, context) : assessMassiveHistory(payload, context);
      let selectedDataHash;
      if (result.status === 'valid-candidate') {
        const selected = kind === 'summary' ? {symbol: payload.symbol, from: payload.from, close: payload.close} : payload.results;
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(selected)));
        selectedDataHash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
      }
      return respond({version, kind, ...result, upstreamHttpStatus: response.status, observedAt: now, selectedDataHash, realLedgerWrites: false});
    } catch {
      return respond({version, kind, status: 'pending', reason: 'source-network-or-evidence-unavailable', sourcePhase, realLedgerWrites: false});
    }
  }};
}

export default marketValidation();
