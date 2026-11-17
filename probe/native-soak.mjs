// Soak test of the SDK's native camera path with destroy-and-rebuild recovery (never reset()).
// Prints one line every 10 s: frame-rate proxies (landmark/expression packets per second), pulse,
// breathing, top validation problem, and restarts. Usage: node native-soak.mjs [seconds]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SmartSpectraSDK, CameraSelection, MetricType, ProcessingStatus } from '@smartspectra/node-sdk';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';

const here = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.join(here, '.env'));
const seconds = Number(process.argv[2] ?? 180);
const camId = SmartSpectraSDK.availableCameras()[0].id;
const metrics = process.env.SOAK_FACE_ONLY ? [MetricType.FACE_LANDMARKS, MetricType.BLINKING, MetricType.TALKING, MetricType.EXPRESSIONS] : [MetricType.BREATHING_RATE, MetricType.PULSE_RATE, MetricType.HRV, MetricType.FACE_LANDMARKS,
  MetricType.BLINKING, MetricType.TALKING, MetricType.EXPRESSIONS];

let sdk = null, token = 0, restarts = 0, rebuilding = false, done = false;
let win = { lm: 0, ex: 0, valid: {}, errors: [] };
let pulse = null, breath = null;
const t0 = Date.now();

// Optional timed plan, e.g. SOAK_PLAN=rest:60,calm:180,tense:180 (overrides the seconds argument).
const plan = (process.env.SOAK_PLAN ?? '').split(',').filter(Boolean).map((p) => { const [name, s] = p.split(':'); return { name, s: Number(s) }; });
const segAt = (sec) => { let acc = 0; for (const p of plan) { acc += p.s; if (sec < acc) return p.name; } return plan.at(-1)?.name ?? 'run'; };
let seg = plan[0]?.name ?? 'run';
const stats = {};
const S = () => (stats[seg] ??= { ex: 0, sum: {}, blinks: 0, talkYes: 0, talkN: 0, lastBlink: false, pulse: [], secs: 0 });

function build() {
  const my = ++token;
  sdk = new SmartSpectraSDK({ apiKey: process.env.SENTI_PRESAGE_KEY, enableTelemetry: false, requestedMetrics: metrics });
  sdk.on('metrics', (buf) => {
    if (my !== token) return;
    const m = decodeMetrics(buf);
    win.lm += m.face?.landmarks?.length ?? 0;
    win.ex += m.face?.expression?.length ?? 0;
    const st = S();
    for (const e of m.face?.expression ?? []) { st.ex++; for (const sc of e.scores ?? []) { const n = ['UNSPECIFIED', 'ANGRY', 'CONTEMPT', 'DISGUST', 'FEAR', 'HAPPY', 'NEUTRAL', 'SAD', 'SURPRISE'][sc.type]; st.sum[n] = (st.sum[n] ?? 0) + (sc.confidence ?? 0); } }
    for (const b of m.face?.blinking ?? []) { if (b.detected && !st.lastBlink) st.blinks++; st.lastBlink = !!b.detected; }
    for (const t of m.face?.talking ?? []) { st.talkN++; if (t.detected) st.talkYes++; }
    for (const pr of m.cardio?.pulseRate ?? []) if ((pr.confidence ?? 0) >= 30) st.pulse.push(pr.value);
    const p = m.cardio?.pulseRate?.at(-1); if (p) pulse = p;
    const b = m.breathing?.rate?.at(-1); if (b) breath = b;
  });
  sdk.on('validationStatus', (code, ts, hint) => { if (my === token && code) win.valid[hint] = (win.valid[hint] ?? 0) + 1; });
  if (process.env.SOAK_VIDEO) sdk.on('videoOutput', () => {});
  sdk.on('error', (code, msg) => { if (my === token) win.errors.push(code); });
  sdk.on('processingStatus', (st) => { if (my === token && st === ProcessingStatus.kError) rebuild(); });
  sdk.useCamera(CameraSelection.byId(camId), process.env.SOAK_RES ? { width: Number(process.env.SOAK_RES.split("x")[0]), height: Number(process.env.SOAK_RES.split("x")[1]) } : undefined);
  sdk.start();
}

async function teardown(old) {
  await Promise.race([old.stopAsync().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
  await old.destroy().catch(() => {});
}

async function rebuild() {
  if (rebuilding || done) return;
  rebuilding = true;
  const old = sdk; token++;
  await teardown(old);
  await new Promise((r) => setTimeout(r, 500));
  if (!done) { build(); restarts++; console.log(`  [rebuilt #${restarts}]`); }
  rebuilding = false;
}

build();
if (plan.length) console.log(`\n========== NOW: ${seg.toUpperCase()} ==========\n`);
setInterval(() => {
  const now = segAt((Date.now() - t0) / 1000);
  if (now !== seg) { seg = now; console.log(`\n========== NOW: ${seg.toUpperCase()} ==========\n`); }
  S().secs++;
}, 1000);
const tick = setInterval(() => {
  const s = Math.round((Date.now() - t0) / 1000);
  process.stdout.write(`[${seg}] `);
  const top = Object.entries(win.valid).sort((a, b) => b[1] - a[1])[0];
  console.log(`${String(s).padStart(4)}s  landmarks/s=${(win.lm / 10).toFixed(1)} expr/s=${(win.ex / 10).toFixed(1)}  pulse=${pulse ? `${pulse.value.toFixed(0)} (conf ${(pulse.confidence ?? 0).toFixed(0)})` : '-'}  breath=${breath ? breath.value.toFixed(0) : '-'}  top-issue=${top ? `${top[0]} x${top[1]}` : 'none'}  errors=${win.errors.join(',') || '-'}  restarts=${restarts}`);
  win = { lm: 0, ex: 0, valid: {}, errors: [] };
}, 10000);

const total = plan.length ? plan.reduce((a, p) => a + p.s, 0) : seconds;
setTimeout(async () => {
  done = true; clearInterval(tick); token++; await teardown(sdk);
  console.log(`\ndone. restarts=${restarts}\n\nPER SEGMENT (expression means are % confidence):`);
  for (const [name, st] of Object.entries(stats)) {
    const m = (k) => (st.ex ? (st.sum[k] ?? 0) / st.ex : 0).toFixed(1);
    const pm = st.pulse.length ? (st.pulse.reduce((a, b) => a + b, 0) / st.pulse.length).toFixed(1) : '-';
    console.log(`${name.padEnd(6)} ${st.secs}s  samples=${st.ex}  NEUTRAL=${m('NEUTRAL')} FEAR=${m('FEAR')} SURPRISE=${m('SURPRISE')} HAPPY=${m('HAPPY')} SAD=${m('SAD')} ANGRY=${m('ANGRY')}  non-neutral=${(100 - Number(m('NEUTRAL'))).toFixed(1)}  blinks/min=${(st.blinks / (st.secs / 60)).toFixed(1)}  talking=${st.talkN ? (st.talkYes / st.talkN).toFixed(2) : '-'}  pulse(conf>=30)=${pm} n=${st.pulse.length}`);
  }
  process.exit(0);
}, total * 1000);
