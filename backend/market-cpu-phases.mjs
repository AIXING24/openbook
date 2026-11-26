export const phaseKinds = ['control', 'fixture-5', 'fixture-50', 'close-four', 'gate-5', 'gate-50', 'evidence-5', 'evidence-50'];

export function phasedMarketKinds(runId) {
  if (runId !== 'cpu-phases-01') throw Error('A fixed synthetic phase run is required');
  return [...phaseKinds, ...phaseKinds.toReversed(), 'unauthorized', 'blocked-source'];
}

export function phaseResultPassed(kind, result) {
  if (kind === 'unauthorized') return result.httpStatus === 401;
  if (kind === 'blocked-source') return result.httpStatus === 404;
  if (!phaseKinds.includes(kind) || result.httpStatus !== 200 || result.payload?.synthetic !== true || result.payload.realLedgerWrites !== false || result.payload.kind !== kind) return false;
  if (kind === 'control') return result.payload.status === 'control-only';
  if (kind === 'close-four') return result.payload.status === 'four-closes-verified' && result.payload.uniqueCloseKeys === 4;
  const count = Number(kind.split('-').at(-1));
  return result.payload.instruments === count && result.payload.status === (kind.startsWith('fixture-') ? 'fixture-built' : 'verified-candidate') && result.payload.issues === 0;
}
