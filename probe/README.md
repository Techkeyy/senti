# Senti probes

These are the feasibility probes I ran before building the app. They talk to the real Presage SmartSpectra SDK and your webcam, so they use camera time and Presage credits. The app does not need them; they are kept as evidence of how the approach was tested, including the pre-registered startle test.

**Setup**

1. `cd probe && npm install` (once).
2. Put your Presage key in `probe/.env`: `SENTI_PRESAGE_KEY=your_key` (the file is gitignored, never commit it). The scripts below that need a key read it from there.

**Scripts**

| Script | What it does | Key needed |
|---|---|---|
| `node probe.mjs --list-cameras` | Lists camera ids | No |
| `node probe.mjs [--camera <id>]` | First feasibility probe: logs every SDK signal and compares a calm and a tense segment (rest 60 s, press `1` for calm, `2` for tense, `q` to finish). Writes `probe/logs/probe-<timestamp>.jsonl` | Yes |
| `node startle.mjs` | The pre-registered startle test: settle 20 s, calm 90 s, tense 90 s, face-only metrics. Rule written before the run: at least 3 head-speed spikes above the calm 99th percentile in tense, at most 1 in calm. Result: tense 11 vs calm 1, PASS. Writes a per-second trace to `probe/logs/` (a copy of that trace is the test fixture `src/shared/__fixtures__/startle-trace.json`) | Yes |
| `node native-soak.mjs [seconds]` | Soak test of the SDK's native camera with destroy-and-rebuild recovery (never `reset()`). Prints a status line every 10 s | Yes |
| `node frame.mjs [width height]` | Diagnostic: saves one frame the SDK actually sees as `probe/logs/sdk-frame.png`, to check lighting and framing | Yes |

`probe/logs/` and `probe/run-*.txt` are gitignored because they are raw logs of a real face's per-second signals.
