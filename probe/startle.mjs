// Pre-registered startle test (the pass rule below was fixed before the run; result in the README Evidence table).
// Plan: settle 20 s (ignored), calm 90 s, tense 90 s. Face-only metrics on the native camera,
// destroy-and-rebuild recovery. Head motion = speed of the face centre (mean of the 478 landmarks)
// normalised by face size, in face-widths per second. Saves a per-second trace and applies the rule:
//   PASS if tense has >= 3 spike events above the calm p99 AND calm has <= 1 such event.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SmartSpectraSDK, CameraSelection, MetricType, ProcessingStatus } from '@smartspectra/node-sdk';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';

const here = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.join(here, '.env'));
const plan = process.env.STARTLE_QUICK ? [['settle', 5], ['calm', 8], ['tense', 8]] : [['settle', 20], ['calm', 90], ['tense', 90]];
const camId = SmartSpectraSDK.availableCameras()[0].id;
const metrics = [MetricType.FACE_LANDMARKS, MetricType.TALKING, MetricType.EXPRESSIONS];
const out = path.join(here, 'logs', `startle-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
fs.mkdirSync(path.dirname(out), { recursive: true });

let sdk = null, token = 0, restarts = 0, rebuilding = false, done = false;
let prev = null;                       // { x, y, t } previous face centre (t in seconds, SDK clock)
let sec = { maxSpeed: 0, n: 0, talk: 0, talkN: 0, fear: 0, surprise: 0, exN: 0 };
const t0 = Date.now();
const elapsed = () => (Date.now() - t0) / 1000;
const segAt = (s) => { let a = 0; for (const [n, d] of plan) { a += d; if (s < a) return n; } return 'end'; };
let seg = 'settle';
const trace = [];

function build() {
  const my = ++token;
  prev = null;
  sdk = new SmartSpectraSDK({ apiKey: process.env.SENTI_PRESAGE_KEY, enableTelemetry: false, requestedMetrics: metrics });
  sdk.on('metrics', (buf) => {
    if (my !== token) return;
    const m = decodeMetrics(buf);
    for (const lm of m.face?.landmarks ?? []) {
      const pts = lm.value ?? [];
      if (pts.length < 10) continue;
      let sx = 0, sy = 0, minX = Infinity, maxX = -Infinity;
      for (const p of pts) { sx += p.x; sy += p.y; if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; }
      const c = { x: sx / pts.length, y: sy / pts.length, t: Number(lm.timestamp) / 1e6, w: maxX - minX };
      if (prev && c.t > prev.t && c.w > 0 && !lm.reset) {
        const speed = Math.hypot(c.x - prev.x, c.y - prev.y) / c.w / (c.t - prev.t);
        if (speed < 50) { sec.maxSpeed = Math.max(sec.maxSpeed, speed); sec.n++; }
      }
      prev = c;
    }
    for (const t of m.face?.talking ?? []) { sec.talkN++; if (t.detected) sec.talk++; }
    for (const e of m.face?.expression ?? []) {
      sec.exN++;
      for (const s of e.scores ?? []) { if (s.type === 4) sec.fear += s.confidence; if (s.type === 8) sec.surprise += s.confidence; }
    }
  });
  sdk.on('processingStatus', (st) => { if (my === token && st === ProcessingStatus.kError) rebuild(); });
  sdk.useCamera(CameraSelection.byId(camId));
  sdk.start();
}
async function teardown(o) { await Promise.race([o.stopAsync().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]); await o.destroy().catch(() => {}); }
async function rebuild() {
  if (rebuilding || done) return; rebuilding = true; const old = sdk; token++;
  await teardown(old); await new Promise((r) => setTimeout(r, 500));
  if (!done) { build(); restarts++; console.log(`  [rebuilt #${restarts}]`); }
  rebuilding = false;
}

if (process.env.STARTLE_PRIO) { const os = await import('node:os'); os.setPriority(0, os.constants.priority.PRIORITY_HIGH); console.log('priority', os.getPriority(0)); }
build();
console.log('\n========== NOW: SETTLE (sit still, video paused) ==========\n');
setInterval(() => {
  const s = Math.floor(elapsed());
  const row = { s, seg, maxSpeed: +sec.maxSpeed.toFixed(3), samples: sec.n, talking: sec.talkN ? +(sec.talk / sec.talkN).toFixed(2) : null,
    fear: sec.exN ? +(sec.fear / sec.exN).toFixed(1) : null, surprise: sec.exN ? +(sec.surprise / sec.exN).toFixed(1) : null, restarts };
  trace.push(row); fs.appendFileSync(out, JSON.stringify(row) + '\n');
  if (s % 5 === 0) console.log(`[${seg}] ${s}s  head-speed max=${row.maxSpeed}  samples/s=${row.samples}  talking=${row.talking}`);
  sec = { maxSpeed: 0, n: 0, talk: 0, talkN: 0, fear: 0, surprise: 0, exN: 0 };
  const now = segAt(elapsed());
  if (now !== seg) {
    seg = now;
    if (seg === 'end') finish();
    else console.log(`\n========== NOW: ${seg === 'calm' ? 'CALM (play the calm video)' : 'TENSE (play the jump-scare video)'} ==========\n`);
  }
}, 1000);

function events(rows, thr) { let n = 0, inEv = false; for (const r of rows) { const hi = r.maxSpeed > thr; if (hi && !inEv) n++; inEv = hi; } return n; }
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };

async function finish() {
  done = true; token++; await teardown(sdk);
  const calm = trace.filter((r) => r.seg === 'calm' && r.samples > 5);
  const tense = trace.filter((r) => r.seg === 'tense' && r.samples > 5);
  const thr = pct(calm.map((r) => r.maxSpeed), 0.99);
  const ce = events(calm, thr), te = events(tense, thr);
  const pass = te >= 3 && ce <= 1;
  console.log(`\nRESULT  calm seconds=${calm.length} tense seconds=${tense.length}  threshold(calm p99)=${thr?.toFixed(3)}`);
  console.log(`spike events: calm=${ce}  tense=${te}  restarts=${restarts}`);
  console.log(`top tense seconds: ${[...tense].sort((a, b) => b.maxSpeed - a.maxSpeed).slice(0, 6).map((r) => `${r.s}s:${r.maxSpeed}`).join('  ')}`);
  console.log(`VERDICT: ${pass ? 'PASS' : 'FAIL'}   trace: ${out}`);
  process.exit(0);
}
