// Senti feasibility probe: logs every SmartSpectra signal and compares calm vs tense segments.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SmartSpectraSDK, CameraSelection, ValidationCode, SmartSpectraErrorCode,
  breathingMetrics, cardioMetrics, faceMetrics,
} from '@smartspectra/node-sdk';
import { decodeMetrics, Metrics, presage } from '@smartspectra/node-sdk/messages';

const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(here, '.env')); } catch { /* no .env yet */ }

const args = process.argv.slice(2);
const argVal = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

if (args.includes('--list-cameras')) {
  const cams = SmartSpectraSDK.availableCameras();
  if (!cams.length) console.log('No cameras found.');
  for (const c of cams) console.log(`id=${c.id}  name=${c.name}  facing=${c.facing}  lens=${c.lensType}`);
  process.exit(0);
}

const apiKey = process.env.SENTI_PRESAGE_KEY;
if (!apiKey || !apiKey.trim()) {
  console.error('No API key. Put SENTI_PRESAGE_KEY=<your key> in probe/.env (see README.md) and run again.');
  process.exit(1);
}

const cams = SmartSpectraSDK.availableCameras();
const camId = argVal('--camera') ?? cams[0]?.id;
if (camId === undefined) { console.error('No camera found. Plug one in, then run --list-cameras.'); process.exit(1); }

const ExpressionType = presage.smartspectra.ExpressionType; // protobufjs enum: also maps number -> name
const exprName = (t) => ExpressionType[t] ?? String(t);
const nameOf = (obj, c) => Object.keys(obj).find((k) => obj[k] === c) ?? String(c);

fs.mkdirSync(path.join(here, 'logs'), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logPath = path.join(here, 'logs', `probe-${stamp}.jsonl`);
const out = fs.createWriteStream(logPath, { flags: 'a' });
const t0 = process.hrtime.bigint();
const nowMs = () => Number(process.hrtime.bigint() - t0) / 1e6;
const log = (type, sdkTs, payload) => out.write(JSON.stringify({ recvMs: +nowMs().toFixed(1), sdkTs, type, payload }) + '\n');

// ---- segment stats ----
const segs = {};
let seg = 'rest';
let segStart = nowMs();
const newSeg = () => ({
  ms: 0, counts: {}, pulse: [], breath: [], hrv: { rmssd: [], sdnn: [], meanNn: [], baevsky: [] },
  blinks: 0, talkYes: 0, talkN: 0, expr: {}, nonNeutral: [], valid: {},
});
const S = () => (segs[seg] ??= newSeg());
S();
const seen = {}; // dedupe by (group, timestamp) in case packets repeat earlier samples
const fresh = (g, ts) => { const k = g + ':' + ts; if (seen[k]) return false; seen[k] = 1; return true; };
let lastBlink = false;
const live = { pulse: null, breath: null, blink: null, talk: null, expr: null, hint: '' };
const problems = [];

function setSeg(n) {
  S().ms += nowMs() - segStart; segStart = nowMs(); seg = n; S();
  log('segment', null, { segment: n });
  console.log(`\n>>> segment: ${n}`);
}

function ingest(m) {
  const s = S();
  const c = (g) => (s.counts[g] = (s.counts[g] ?? 0) + 1);
  for (const x of m.cardio?.pulseRate ?? []) if (fresh('pulse', x.timestamp)) { c('pulseRate'); s.pulse.push(x.value); live.pulse = x.value; }
  for (const x of m.breathing?.rate ?? []) if (fresh('breath', x.timestamp)) { c('breathingRate'); s.breath.push(x.value); live.breath = x.value; }
  for (const x of m.cardio?.hrv ?? []) if (fresh('hrv', x.timestamp)) {
    c('hrv'); for (const k of ['rmssd', 'sdnn', 'meanNn', 'baevsky']) s.hrv[k].push(x[k]);
  }
  for (const x of m.cardio?.arterialPressureTrace ?? []) if (fresh('ap', x.timestamp)) c('arterialPressureTrace');
  for (const x of m.face?.blinking ?? []) if (fresh('blink', x.timestamp)) {
    c('blinking'); if (x.detected && !lastBlink) s.blinks++; lastBlink = x.detected; live.blink = x.detected;
  }
  for (const x of m.face?.talking ?? []) if (fresh('talk', x.timestamp)) {
    c('talking'); s.talkN++; if (x.detected) s.talkYes++; live.talk = x.detected;
  }
  for (const x of m.face?.expression ?? []) if (fresh('expr', x.timestamp)) {
    c('expressions');
    let nn = 0, top = null;
    for (const sc of x.scores) {
      const n = exprName(sc.type);
      (s.expr[n] ??= []).push(sc.confidence);
      if (n !== 'NEUTRAL') nn += sc.confidence;
      if (!top || sc.confidence > top.v) top = { n, v: sc.confidence };
    }
    s.nonNeutral.push(nn); live.expr = top;
  }
  for (const x of m.face?.landmarks ?? []) if (fresh('lm', x.timestamp)) c('landmarks');
}

// Compact payload: protobuf -> plain object, drop landmark points and long traces (keep counts).
function compact(m) {
  const o = Metrics.toObject(m, { longs: Number, enums: String, defaults: false });
  if (o.face?.landmarks) o.face.landmarks = o.face.landmarks.map((l) => ({ n: l.value?.length ?? 0, stable: l.stable, reset: l.reset, timestamp: l.timestamp }));
  for (const [grp, keys] of [['breathing', ['upperTrace', 'lowerTrace']], ['cardio', ['arterialPressureTrace']], ['eda', ['trace']]]) {
    for (const k of keys) if (o[grp]?.[k]) { o[grp][k + 'Count'] = o[grp][k].length; delete o[grp][k]; }
  }
  return o;
}

const sdk = new SmartSpectraSDK({
  apiKey,
  enableTelemetry: false,
  enableAccumulatedOutput: true,
  requestedMetrics: argVal('--metrics') === 'cardio' ? [...cardioMetrics] : [...breathingMetrics, ...cardioMetrics, ...faceMetrics],
});
if (argVal('--seconds')) setTimeout(shutdown, Number(argVal('--seconds')) * 1000);

sdk.on('metrics', (buf, ts) => {
  try { const m = decodeMetrics(buf); log('metrics', ts, compact(m)); ingest(m); }
  catch (e) { log('decodeError', ts, { message: String(e) }); }
});
sdk.on('accumulatedMetrics', (buf, ts) => {
  try { log('accumulatedMetrics', ts, compact(decodeMetrics(buf))); } catch (e) { log('decodeError', ts, { message: String(e) }); }
});
sdk.on('validationStatus', (code, ts, hint) => {
  const n = nameOf(ValidationCode, code);
  log('validationStatus', ts, { code, name: n, hint });
  live.hint = code === ValidationCode.kOk ? 'ok' : `${n}${hint ? ' (' + hint + ')' : ''}`;
  if (code !== ValidationCode.kOk) { const v = S().valid; v[n] = (v[n] ?? 0) + 1; }
});
sdk.on('processingStatus', (st) => { log('processingStatus', null, { status: st }); console.log(`[processingStatus ${st}]`); });
sdk.on('error', (code, message, retryable) => {
  const n = nameOf(SmartSpectraErrorCode, code);
  log('error', null, { code, name: n, message, retryable });
  problems.push({ seg, name: n, message });
  console.error(`[error] ${n}: ${message}`);
});

let stopping = false;
async function shutdown() {
  if (stopping) return; stopping = true;
  clearInterval(ticker);
  console.log('\nStopping...');
  try { await sdk.stopAsync(); } catch (e) { console.error('stop failed:', e.message); }
  try { await sdk.destroy(); } catch (e) { console.error('destroy failed:', e.message); }
  S().ms += nowMs() - segStart;
  summary();
  out.end(() => process.exit(0));
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const f = (v, d = 1) => (v == null ? 'n/a' : v.toFixed(d));

function summary() {
  console.log('\n===== SUMMARY =====');
  for (const [name, s] of Object.entries(segs)) {
    const min = s.ms / 60000;
    console.log(`\n--- ${name} --- duration ${f(s.ms / 1000)} s`);
    console.log('sample counts:', Object.keys(s.counts).length ? JSON.stringify(s.counts) : '(none)');
    console.log(`mean pulse: ${f(mean(s.pulse))} bpm | mean breathing: ${f(mean(s.breath))} /min`);
    const h = s.hrv;
    console.log(`HRV: ${h.rmssd.length ? `n=${h.rmssd.length} rmssd=${f(mean(h.rmssd))} sdnn=${f(mean(h.sdnn))} meanNn=${f(mean(h.meanNn))} baevsky=${f(mean(h.baevsky))}` : 'none'}`);
    console.log(`blinks/min: ${min > 0 ? f(s.blinks / min) : 'n/a'} (${s.blinks} blinks) | talking fraction: ${s.talkN ? f(s.talkYes / s.talkN, 2) : 'n/a'}`);
    const ex = Object.entries(s.expr).map(([k, v]) => `${k}=${f(mean(v))}`).join(' ');
    console.log(`expressions (mean %): ${ex || 'none'} | non-neutral: ${f(mean(s.nonNeutral))}`);
    console.log('validation problems:', Object.keys(s.valid).length ? JSON.stringify(s.valid) : 'none');
  }
  const bad = problems.filter((p) => /NotAuthorized|CreditExhausted|Authentication/.test(p.name));
  console.log('\nauthorization/credit errors:', bad.length ? '' : 'none');
  for (const p of bad) console.log(`  [${p.seg}] ${p.name}: ${p.message}`);
  const other = problems.filter((p) => !bad.includes(p));
  if (other.length) { console.log('other errors:'); for (const p of other) console.log(`  [${p.seg}] ${p.name}: ${p.message}`); }
  console.log(`\nlog: ${logPath}`);
}

const ticker = setInterval(() => {
  const e = live.expr ? `${live.expr.n} ${live.expr.v.toFixed(0)}%` : '-';
  console.log(`[${seg}] pulse=${f(live.pulse, 0)} breath=${f(live.breath, 0)} blink=${live.blink ?? '-'} talk=${live.talk ?? '-'} expr=${e} valid=${live.hint || '-'}`);
}, 2000);

try {
  sdk.useCamera(CameraSelection.byId(camId));
  sdk.start();
} catch (e) {
  clearInterval(ticker);
  console.error(`Could not start measurement: ${nameOf(SmartSpectraErrorCode, e.code)} ${e.message}`);
  try { await sdk.destroy(); } catch { /* ignore */ }
  process.exit(1);
}
console.log(`Camera ${camId}. Log: ${logPath}\nKeys: 1=calm  2=tense  q=stop (Ctrl+C also stops)`);

process.on('SIGINT', shutdown);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (d) => {
    const k = d.toString();
    if (k === '1') setSeg('calm');
    else if (k === '2') setSeg('tense');
    else if (k === 'q' || k === '\u0003') shutdown();
  });
} else console.log('(stdin is not a TTY: keyboard control disabled)');
