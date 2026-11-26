import originalValidation, {mockMarketEvidence} from './market-validation.mjs';
import {assessValuationEvidence, marketCloseAt} from './market-evidence.mjs';
import {phaseKinds} from './market-cpu-phases.mjs';

const fixtures = new Map([5, 50].map(count => [count, mockMarketEvidence(count)]));
const closes = [['us', '16:00', '21:00'], ['hk', '16:10', '08:10'], ['sh', '15:00', '07:00'], ['sz', '15:00', '07:00']];
const respond = (body, status = 200) => Response.json(body, {status, headers: {'cache-control': 'no-store'}});

export function marketPhaseValidation(validation = originalValidation) {
  return {async fetch(request, env) {
    const url = new URL(request.url), kind = url.searchParams.get('kind');
    const allowed = url.pathname === '/validation/market' && phaseKinds.includes(kind);
    if (allowed && kind.startsWith('evidence-')) return validation.fetch(request, env);
    const authorization = await validation.fetch(new Request(new URL('/validation/status', url), {method: request.method, headers: request.headers}), env);
    if (!authorization.ok) return authorization;
    if (!allowed) return respond({error: 'Synthetic phase route only'}, 404);
    const base = {version: 'market-phases v0.3.6', kind, synthetic: true, realLedgerWrites: false};
    if (kind === 'control') return respond({...base, status: 'control-only'});
    if (kind === 'close-four') {
      const valid = closes.every(([market, time, utcTime]) => marketCloseAt('2026-11-24', market, time) === Date.parse('2026-11-24T' + utcTime + ':00Z'));
      return respond({...base, status: valid ? 'four-closes-verified' : 'pending', uniqueCloseKeys: 4});
    }
    const count = Number(kind.split('-').at(-1));
    if (kind.startsWith('fixture-')) {
      const fixture = mockMarketEvidence(count);
      return respond({...base, status: 'fixture-built', instruments: fixture.instruments.length, issues: 0});
    }
    const result = assessValuationEvidence(fixtures.get(count));
    return respond({...base, status: result.status, instruments: count, issues: result.issues?.length ?? 0});
  }};
}

export default marketPhaseValidation();
