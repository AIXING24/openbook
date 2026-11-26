const runIds = ['cpu-repeat-01', 'cpu-repeat-02'];

export function validationReportPrefix({withSourceKey, runId}) {
  if (typeof withSourceKey !== 'boolean') throw Error('Invalid source mode');
  if (runId === undefined) return withSourceKey ? 'market-massive-cloud' : 'market-cloud';
  if (withSourceKey || ![...runIds, 'cpu-tail-probe-01', 'cpu-tail-probe-02', 'cpu-phases-01'].includes(runId)) throw Error('Invalid repeated isolation run');
  return 'market-' + runId;
}

export function parseValidationRun(args) {
  const selected = args.filter(value => value.startsWith('--run-id='));
  if (selected.length > 1 || args.some(value => !['--mock-only', '--with-massive-secret'].includes(value) && !value.startsWith('--run-id=')) || (args.includes('--mock-only') && args.includes('--with-massive-secret'))) throw Error('Invalid isolation arguments');
  const mode = {withSourceKey: args.includes('--with-massive-secret'), runId: selected[0]?.slice('--run-id='.length)};
  validationReportPrefix(mode);
  return mode;
}

export function repeatedMarketKinds(runId) {
  validationReportPrefix({withSourceKey: false, runId});
  if (!runIds.includes(runId)) throw Error('A repeated run is required');
  const first = runId === runIds[0] ? 5 : 50, second = first === 5 ? 50 : 5;
  return [...Array.from({length: 24}, (unusedValue, index) => 'evidence-' + (index % 2 ? second : first)), 'unauthorized', 'source-secret-missing'];
}

export function assessCpuObservation(report, thresholdMs = 10) {
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0 || !Number.isSafeInteger(report.expectedClientRequests) || report.expectedClientRequests <= 0 || !Array.isArray(report.buckets)) throw Error('Invalid CPU observation');
  let requests = 0, errors = 0, subrequests = 0, maxCpuMs = null;
  for (const bucket of report.buckets) {
    if (!Number.isFinite(bucket.max?.cpuTime) || bucket.max.cpuTime < 0 || !['requests', 'errors', 'subrequests'].every(field => Number.isSafeInteger(bucket.sum?.[field]) && bucket.sum[field] >= 0)) throw Error('Invalid official CPU bucket');
    requests += bucket.sum.requests;
    errors += bucket.sum.errors;
    subrequests += bucket.sum.subrequests;
    maxCpuMs = Math.max(maxCpuMs ?? 0, bucket.max.cpuTime / 1000);
  }
  const peakObserved = maxCpuMs !== null && maxCpuMs > thresholdMs;
  const countsMatched = requests === report.expectedClientRequests;
  return {status: peakObserved ? 'peak-reproduced' : countsMatched && errors === 0 && maxCpuMs !== null ? 'no-peak-observed' : 'inconclusive', thresholdMs, maxCpuMs, observedRequests: requests, observedErrors: errors, observedSubrequests: subrequests, countsMatched, coldStartsProven: false, universalFreeHeadroomProven: false};
}
