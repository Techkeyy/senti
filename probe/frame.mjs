// Diagnostic: save what the SDK actually sees (one frame from the SDK's videoOutput) as a PNG.
// Usage: node frame.mjs [width height]
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SmartSpectraSDK, CameraSelection, breathingMetrics, cardioMetrics, faceMetrics, PixelFormat, SmartSpectraLogLevel } from '@smartspectra/node-sdk';

const here = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.join(here, '.env'));
const [w, h] = process.argv.slice(2).map(Number);
const cam = SmartSpectraSDK.availableCameras()[0];
const sdk = new SmartSpectraSDK({ apiKey: process.env.SENTI_PRESAGE_KEY, enableTelemetry: false, logLevel: SmartSpectraLogLevel.kInfo,
  requestedMetrics: [...breathingMetrics, ...cardioMetrics, ...faceMetrics] });

function png(buf, width, height, stride, fmt) {
  const bpp = fmt === PixelFormat.kRGBA || fmt === PixelFormat.kBGRA ? 4 : 3;
  const bgr = fmt === PixelFormat.kBGR || fmt === PixelFormat.kBGRA;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const s = y * stride + x * bpp, d = y * (width * 3 + 1) + 1 + x * 3;
      raw[d] = buf[bgr ? s + 2 : s]; raw[d + 1] = buf[s + 1]; raw[d + 2] = buf[bgr ? s : s + 2];
    }
  }
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(width, 0); ih.writeUInt32BE(height, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

let saved = false;
const t0 = Date.now();
sdk.on('videoOutput', (buf, width, height, stride, fmt) => {
  if (saved || Date.now() - t0 < 6000) return;
  saved = true;
  const out = path.join(here, 'logs', 'sdk-frame.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, png(buf, width, height, stride, fmt));
  console.log(`saved ${out} ${width}x${height} stride=${stride} fmt=${fmt}`);
});
sdk.on('validationStatus', (c, ts, hint) => { if (Date.now() - t0 > 5000 && !saved) console.log('validation', c, hint); });
sdk.on('error', (c, m) => console.log('error', c, m));
sdk.useCamera(CameraSelection.byId(cam.id), w ? { width: w, height: h } : undefined);
sdk.start();
setTimeout(async () => { await sdk.stopAsync().catch(() => {}); sdk.destroy(); process.exit(0); }, 10000);
