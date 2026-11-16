# Senti probe

Runs the real Presage SmartSpectra SDK on your webcam and logs every signal.

1. `npm install` (once). Put your key in `probe/.env`: `SENTI_PRESAGE_KEY=your_key` (gitignored).
2. `node probe.mjs --list-cameras` shows camera ids (no key needed).
3. `node probe.mjs [--camera <id>]` starts measuring (default: first camera).
4. Protocol: sit still 60 s (segment "rest"), press `1`, play/watch something calm for 3 min,
   press `2`, play/watch something tense or scary for 3 min, press `q`.
5. A per-segment summary prints on exit; Ctrl+C also stops cleanly.
6. Full log: `probe/logs/probe-<timestamp>.jsonl` (one JSON line per event).
