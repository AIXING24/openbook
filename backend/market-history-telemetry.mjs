import {phaseKinds} from './market-cpu-phases.mjs';
const requestKinds = [...phaseKinds, 'summary', 'history', 'fx', 'today-readiness'];
const targetKind = (stage, checks) => stage.kind === 'unauthorized' && checks.runId === 'cpu-phases-01' ? 'evidence-5' : ['unauthorized', 'source-secret-missing', 'blocked-source'].includes(stage.kind) ? 'summary' : stage.kind;

export function analyzeHistoricalWindow(rows, checks, cpu) {
  if (!Array.isArray(rows) || !Array.isArray(checks?.stages) || !checks.stages.length || !Array.isArray(cpu?.buckets)) throw Error('Invalid historical evidence');
  for (const stage of checks.stages) {
    if (!requestKinds.includes(targetKind(stage, checks)) || !Number.isFinite(Date.parse(stage.startedAt)) || !Number.isFinite(Date.parse(stage.completedAt)) || Date.parse(stage.startedAt) > Date.parse(stage.completedAt)) throw Error('Invalid client stage');
  }
  const calls = rows.map(row => {
    if (!Array.isArray(row) || row.length !== 5) throw Error('Invalid displayed row');
    const [loggedAt, requestKind, cpuDisplayMs, logLevel, outcome] = row;
    if (!Number.isFinite(Date.parse(loggedAt)) || !requestKinds.includes(requestKind) || (cpuDisplayMs !== null && (!Number.isFinite(cpuDisplayMs) || cpuDisplayMs < 0)) || !['info', 'error', 'unknown'].includes(logLevel) || !['ok', 'exception', 'exceededCpu', 'unknown'].includes(outcome)) throw Error('Invalid displayed evidence');
    const candidates = checks.stages.map((stage, index) => ({stage, index})).filter(({stage}) => targetKind(stage, checks) === requestKind && Math.abs(Date.parse(loggedAt) - Date.parse(stage.completedAt)) <= 1000);
    const match = candidates.length === 1 ? candidates[0] : null;
    return {loggedAt, requestKind, cpuDisplayMs, logLevel, outcome, clientSequence: match ? match.index + 1 : null, clientKind: match?.stage.kind ?? null, clientHttpStatus: match?.stage.httpStatus ?? null, clientClockDeltaMs: match ? Date.parse(loggedAt) - Date.parse(match.stage.completedAt) : null};
  });
  const counts = checks.stages.map((stage, index) => calls.filter(call => call.clientSequence === index + 1).length);
  const sequenceComplete = calls.length === checks.stages.length && counts.every(count => count === 1) && new Set(calls.map(call => call.loggedAt)).size === calls.length;
  const bucketCandidates = cpu.buckets.map(bucket => {
    if (!Number.isFinite(Date.parse(bucket.dimensions?.datetime)) || bucket.dimensions?.scriptName !== 'gaintrace-market-validation' || !Number.isSafeInteger(bucket.sum?.requests) || bucket.sum.requests < 0 || !Number.isFinite(bucket.max?.cpuTime) || bucket.max.cpuTime < 0) throw Error('Invalid CPU bucket');
    return calls.filter(call => {
      if (!call.clientSequence) return false;
      const stage = checks.stages[call.clientSequence - 1];
      const second = Date.parse(bucket.dimensions.datetime);
      return second >= Math.floor(Date.parse(stage.startedAt) / 1000) * 1000 && second <= Math.floor(Date.parse(call.loggedAt) / 1000) * 1000;
    });
  });
  for (const call of calls) {
    const candidates = cpu.buckets.filter((bucket, index) => bucket.sum.requests === 1 && bucketCandidates[index].length === 1 && bucketCandidates[index][0] === call);
    call.correlatedBucketMaximumCpuMs = candidates.length === 1 && sequenceComplete ? candidates[0].max.cpuTime / 1000 : null;
    call.correlatedBucketTime = call.correlatedBucketMaximumCpuMs === null ? null : candidates[0].dimensions.datetime;
  }
  const displayedCpu = calls.filter(call => call.cpuDisplayMs !== null).map(call => call.cpuDisplayMs);
  const correlatedCpu = calls.filter(call => call.correlatedBucketMaximumCpuMs !== null).map(call => call.correlatedBucketMaximumCpuMs);
  const displayedCpuComplete = sequenceComplete && displayedCpu.length === calls.length;
  const bucketCorrelationComplete = sequenceComplete && correlatedCpu.length === calls.length;
  const maxDisplayedCpuMs = displayedCpu.length ? Math.max(...displayedCpu) : null;
  const maxCorrelatedBucketCpuMs = correlatedCpu.length ? Math.max(...correlatedCpu) : null;
  const maxAggregateCpuMs = cpu.buckets.length ? Math.max(...cpu.buckets.map(bucket => bucket.max.cpuTime / 1000)) : null;
  const peak = (maxDisplayedCpuMs !== null && maxDisplayedCpuMs > 10) || (maxAggregateCpuMs !== null && maxAggregateCpuMs > 10);
  return {expectedClientCalls: checks.stages.length, displayedCalls: calls.length, sequenceComplete, displayedCpuComplete, bucketCorrelationComplete, maxDisplayedCpuMs, maxCorrelatedBucketCpuMs, maxAggregateCpuMs,
    status: peak ? 'peak-reproduced' : displayedCpuComplete && bucketCorrelationComplete && calls.every(call => call.outcome === 'ok') ? 'no-peak-observed' : 'inconclusive',
    missingBucketCorrelations: calls.filter(call => call.correlatedBucketMaximumCpuMs === null).map(call => ({loggedAt: call.loggedAt, clientSequence: call.clientSequence, clientKind: call.clientKind, cpuDisplayMs: call.cpuDisplayMs})),
    coldStartsProven: false, universalFreeHeadroomProven: false, calls};
}
