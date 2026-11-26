import {readFileSync, writeFileSync} from 'node:fs';
import {analyzeHistoricalWindow} from '../market-history-telemetry.mjs';
import {phasedMarketKinds} from '../market-cpu-phases.mjs';

const prefix = 'market-cpu-phases-01';
const read = kind => JSON.parse(readFileSync(prefix + '-' + kind + '-v0.3.6.json', 'utf8'));
const checks = read('checks'), cpu = read('cpu'), dashboard = read('dashboard');
if (checks.runId !== 'cpu-phases-01' || JSON.stringify(checks.stages.map(stage => stage.kind)) !== JSON.stringify(phasedMarketKinds(checks.runId)) || !checks.stages.every(stage => stage.passed) || dashboard.runId !== checks.runId || dashboard.timeRange.start !== cpu.timeRange.start || dashboard.timeRange.end !== cpu.timeRange.end) throw Error('Unexpected synthetic evidence window');
const result = analyzeHistoricalWindow(dashboard.rows, checks, cpu);
const report = {version: 'backend v0.3.6 candidate', runId: checks.runId, source: 'Offline correlation of sanitized visible Workers Logs, known client stages and official single-request CPU buckets', limitations: checks.phaseLimitations, ...result};
writeFileSync(prefix + '-correlation-v0.3.6.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({...report, calls: undefined}));
console.log(JSON.stringify(report.calls.map(call => ({sequence: call.clientSequence, kind: call.clientKind, cpuMs: call.correlatedBucketMaximumCpuMs, displayedCpuMs: call.cpuDisplayMs}))));
