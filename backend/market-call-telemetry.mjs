export const tailProbeKinds = ['evidence-5', 'evidence-50', 'evidence-5'];
export const tailProbeHost = 'gaintrace-market-validation.aixing24-gaintrace.workers.dev';

export function sanitizeMarketCall(event, probe) {
  if (typeof probe !== 'string' || !/^[a-f0-9]{32}$/.test(probe)) throw Error('Invalid probe marker');
  let target;
  try {target = new URL(event?.event?.request?.url ?? event?.$workers?.event?.request?.url);} catch {return null;}
  const sequence = target.searchParams.get('seq');
  if (target.protocol !== 'https:' || target.hostname !== tailProbeHost || target.port || target.pathname !== '/validation/market' || target.searchParams.get('probe') !== probe || !/^[1-3]$/.test(sequence ?? '')) return null;
  const kind = target.searchParams.get('kind');
  if (kind !== tailProbeKinds[Number(sequence) - 1]) return null;
  const outcome = event.outcome ?? event.$workers?.outcome;
  const cpu = event.$workers?.cpuTimeMs;
  return {
    sequence: Number(sequence), kind,
    outcome: ['ok', 'exception', 'exceededCpu', 'exceededMemory', 'canceled', 'unknown'].includes(outcome) ? outcome : 'unknown',
    cpuMs: Number.isFinite(cpu) && cpu >= 0 ? cpu : null,
    cpuSource: Number.isFinite(cpu) && cpu >= 0 ? '$workers.cpuTimeMs' : null,
    fieldPresence: {cpuTime: Object.hasOwn(event, 'cpuTime'), cpuTimeMs: Object.hasOwn(event, 'cpuTimeMs'), workersCpuTimeMs: Object.hasOwn(event.$workers ?? {}, 'cpuTimeMs')}
  };
}

export function assessMarketCalls(calls) {
  if (!Array.isArray(calls)) throw Error('Invalid call evidence');
  const counts = tailProbeKinds.map((kind, index) => calls.filter(call => call.sequence === index + 1 && call.kind === kind).length);
  const complete = calls.length === 3 && counts.every(count => count === 1);
  const validCpu = call => call.cpuSource === '$workers.cpuTimeMs' && Number.isFinite(call.cpuMs) && call.cpuMs >= 0;
  const cpuValues = calls.filter(validCpu).map(call => call.cpuMs);
  const maxCpuMs = cpuValues.length ? Math.max(...cpuValues) : null;
  const cpuComplete = complete && calls.every(validCpu);
  const outcomesOk = complete && calls.every(call => call.outcome === 'ok');
  return {expectedCalls: 3, observedCalls: calls.length, counts, sequenceComplete: complete, cpuComplete, outcomesOk, maxCpuMs,
    status: maxCpuMs !== null && maxCpuMs > 10 ? 'peak-reproduced' : cpuComplete && outcomesOk ? 'no-peak-observed' : 'inconclusive',
    coldStartsProven: false, universalFreeHeadroomProven: false};
}
