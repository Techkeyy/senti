# Senti: director's file

This is the handover document. A new director should be able to take over from this file alone. Update it at every checkpoint.

- **Owner:** Techkeyy (GitHub). Solo entry.
- **Hackathon:** DEV x Presage SmartSpectra SDK Challenge. Rules: https://dev.to/challenges/presage-2026-11-04
- **Deadline:** 22 Nov 2026, 11:59 PM PST = **23 Nov 2026, 07:59 UTC**. Hard stop.
- **Research behind the idea:** `C:\Users\HomePC\Desktop\skill\idea-research\presage-smartspectra-idea-research.md` (the idea was called "Felt" there; the product name is now **Senti**, Spanish for "I felt").
- **Director standard:** `C:\Users\HomePC\Desktop\skill\master director skill.txt`, plus the local skills in `Desktop\skill\` (build-process, project-understanding, design-skill, perfect-readme, demo-video, project-edge, audit-skill, critical-bug, hackathon-onboarding).
- **Working style:** Claude directs. Sub-agents (Sonnet and Haiku) build from exact orders. The director reviews the evidence before accepting any PASS. Commits happen at checkpoints with no co-author or attribution lines, after a secrets scan.

---

## 1. Product promise

- **Product:** Senti
- **Intended user:** an indie game developer or designer who runs playtests.
- **Core problem:** designers plan how a level should feel (calm, then tense, then a scare, then a boss), but they cannot see whether players actually felt that. Spoken feedback is polite and unreliable, so designers end up watching hours of facecam footage and guessing.
- **Core promise:** draw the tension curve you intended, run a playtest, and Senti shows the curve the player actually felt (read live from the webcam with Presage SmartSpectra) over the gameplay recording, flagging where the two disagree.

**Real user journey (this is the primary acceptance test):**
1. Install and open Senti on Windows. Enter your own free Presage API key once.
2. Create a playtest: name it, pick the game window to record, and draw the intended tension curve. Optionally name beats such as "first enemy" or "jump scare".
3. The playtester reads a plain consent screen and agrees.
4. Camera check: live guidance until the face is well lit and centred.
5. A 60-second resting baseline.
6. Play. Senti records the game window and streams live SDK signals. A hotkey drops beat markers. The live signals are visible to the designer.
7. Stop. Senti saves the session.
8. Report: the gameplay video with the intended and felt curves underneath and the mismatches flagged. Clicking a mismatch seeks the video.
9. Sessions persist across restarts and can be deleted in one click.

**Final outcome:** the designer sees, for a real playtest, where their level did and did not land, without watching raw footage.

**Core Outcome sentence:** *Senti is only genuinely working when a real playtester's live webcam signals, captured during a real play session, produce a felt-tension curve aligned to the gameplay recording, and the report correctly flags at least one segment where the felt curve disagrees with the designer's intended curve.*

## 2. What must be real

- Real SmartSpectra SDK (`@smartspectra/node-sdk`), real webcam, real API key, live signals. No mocked or replayed signals in the product path. (A fixture may exist only for unit tests and must never appear in the UI as live.)
- Real screen recording of the game window, saved to disk.
- Real persistence: sessions survive an app restart, and delete really deletes.
- Anyone can use it: each user brings their own free Presage key, entered in the app UI (never `.env` for end users). No accounts, no server of ours.
- "Deployed" means a packaged Windows build on GitHub Releases plus the public repo. A judge can run it without our terminal.

## 3. Claim → Mechanism → Boundary → Proof ledger

| Claim | Mechanism | Boundary | Required proof | Current proof | Status |
| --- | --- | --- | --- | --- | --- |
| Felt curve comes from live Presage signals | SDK `metrics` events → felt-intensity module | SDK on device | Live session log + video showing raw SDK values | none | UNPROVEN |
| Signals separate calm from tense segments | per-segment aggregation vs baseline | felt-intensity module | Day-1 probe: calm 3 min vs horror 3 min show a clear difference | none | UNPROVEN (load-bearing) |
| Curves align with gameplay video | shared monotonic clock for recording start, markers and samples | main process clock | Marker in the video at t matches marker on the chart at t (±1 s) | none | UNPROVEN |
| Mismatches are flagged correctly | deterministic diff rules (intended vs felt per segment) | pure module + unit tests | Unit tests + one real session with a known mismatch | none | UNPROVEN |
| Face video is never stored or sent | we only store screen video + numbers; SDK computes on device | our code + SDK | Code review: no camera frames written; telemetry off | none | UNPROVEN |
| SDK telemetry is off | `enableTelemetry: false` | SDK config | Config in code + doc | none | UNPROVEN |
| Delete removes everything | delete session folder | filesystem | Test + manual check | none | UNPROVEN |

## 4. Scope

- **NOW (MVP):** API key entry, create playtest (name, window, intended curve, optional beats), consent, camera check, baseline, live session with recording + markers, stop/save, report with two curves + mismatch flags + seek, session list with delete, Windows installer.
- **NEXT:** combining several testers into an average curve, an LLM Insights summary per segment (optional, disclosed), CSV/JSON export.
- **LATER:** remote testers, Unity/Godot marker plugin, Steam Playtest integration, macOS build.
- **NON-GOALS:** medical or health claims, monitoring anyone who has not consented, storing face video, cloud accounts, multi-face scenes.

## 5. Architecture (decided; change only with a written reason)

- **Electron + electron-vite + React + TypeScript**, Windows x64 first (the SDK supports `win32-x64`). Packaged with electron-builder (NSIS installer).
- **SDK:** `@smartspectra/node-sdk` (latest 3.5.0). Camera ownership is decided by the Phase 2 probe (main-process `useCamera(byId)` vs renderer `useMediaStream`).
- **Screen recording:** `desktopCapturer` + `MediaRecorder` (webm) in the renderer.
- **Felt intensity:** a pure TypeScript module, unit tested (Vitest). Inputs are the SDK samples and baseline; output is a per-segment felt score plus a smoothed curve.
- **Storage:** `userData/sessions/<id>/` holding `session.json` (intended curve, markers, samples, baseline, timings) and `gameplay.webm`. The API key is stored with Electron `safeStorage`.
- **No backend.** The only network traffic is the SDK's own auth/subscription check (plus LLM Insights only if added and enabled).

## 6. Phases and gates

| Phase | Goal | Gate to pass | Status |
| --- | --- | --- | --- |
| 0 Understand | research, rules, SDK surface | research doc complete | DONE (16 Nov) |
| 1 Define | promise, Core Outcome, ledger, scope | this file | DONE (16 Nov) |
| 2 Feasibility | probe: key works, face metrics authorized, credits, signal separation, camera + screen capture coexist | all 5 checks PASS with logged evidence | IN PROGRESS |
| 3 Vertical slice | one playtest end to end (ugly UI ok): curve → session → report with real signals | Core Outcome observed once | PENDING |
| 4 Product shell | design skill: real UI, four states, copy | first-time-user pass | PENDING |
| 5 Failure/recovery | camera lost, no face, key invalid, credits exhausted, app restart mid-session, delete | critical-bug red-team pass | PENDING |
| 6 Package | Windows installer on GitHub Releases | fresh-machine install runs | PENDING |
| 7 UAT | owner runs the full journey from the installer | owner PASS | PENDING |
| 8 Submission | README (perfect-readme), demo video (demo-video), DEV post, consent section | all hackathon gates | PENDING |

**Halfway checkpoint:** by **19 Nov 23:59 UTC**, Phase 3 must be done. If not, cut scope.

## 7. Feature completion matrix

| Feature | UI | Logic | Real SDK | Package | Manual test | Recovery | FINAL |
| --- | --- | --- | --- | --- | --- | --- | --- |
| API key entry | - | - | - | - | - | - | - |
| Intended curve editor | - | - | n/a | - | - | - | - |
| Consent + camera check | - | - | - | - | - | - | - |
| Baseline | - | - | - | - | - | - | - |
| Live session + recording + markers | - | - | - | - | - | - | - |
| Report (curves, mismatches, seek) | - | - | - | - | - | - | - |
| Session list + delete | - | - | n/a | - | - | - | - |

## 8. Hackathon compliance gates

| Gate | Requirement | Status |
| --- | --- | --- |
| New project | started during 4 to 22 Nov | PASS (repo created 16 Nov) |
| SDK + live signal | SmartSpectra in a working app, one or more live signals | PENDING |
| Public repo + setup instructions | | PENDING |
| Demo video showing the live signal | | PENDING |
| DEV post from the template, tags `devchallenge, presagechallenge` | | PENDING |
| Consent and Data Handling section (storage, retention, deletion, telemetry, AI use) | | PENDING |
| No medical claims, no covert monitoring | | PENDING (copy review) |
| Prize categories noted (enter both) | | PENDING |
| Optional: agent session embed | | PENDING |

## 9. Current status

**BUILDING: CORE PATH NOT YET PROVEN.** Repo created. Phase 2 probe being built. **Blocked on the owner's Presage API key** (register at https://physiology.presagetech.com/auth/register) and on a human in front of the webcam for the signal-separation test.

## 10. Decision log

- 16 Nov: idea locked as Felt → renamed **Senti** by the owner. Flinch was rejected (HypeClips, Pulsoid and StreamMyHeart already ship it).
- 16 Nov: stack set as Electron + electron-vite + React + TS. Reason: the SDK's desktop binding is Node/Electron, and the owner is on Windows.
- 16 Nov: keys are entered in the app UI per user, so anyone can use it with their own free key.

## 11. Agent log

| When | Agent | Order | Result | Director verdict |
| --- | --- | --- | --- | --- |
| 16 Nov | Sonnet | Phase 2 probe (`probe/probe.mjs`): SDK on webcam, JSONL log, calm/tense segments, summary | SDK 3.5.0 loads on Windows; camera listing works without a key ("HP HD Camera"); a missing key gives a clean error. Live run untested (no key) | ACCEPTED as COMPONENT PROVEN (offline). Re-verified by the director. Committed 7e1bac7 |
| 16 Nov | Sonnet | Scaffold electron-vite React TS app + recorder spike: webcam preview and screen recording at the same time, plus an autotest | Camera 332 frames in 10 s while recording the screen; webm saved; build + typecheck pass. Versions: electron 45.3.3, electron-vite 6, vite 8, React 19.3, TS 7.0.2, electron-builder 26.18 | ACCEPTED, COMPONENT PROVEN. Director re-ran it: 301 frames, camera "live", 794 KB webm. Still unverified: window (not screen) capture, fullscreen games, installer |
| 16 Nov | Director | Live probe smoke run with the owner's key (all metric groups, 3.5 min) | Auth OK. Face (expressions ~30/s, blink, talk) and breathing arrive. **Zero cardio (pulse/HRV) samples, no error.** kFaceNotForward on most frames | Check 2 PARTIAL. Next: cardio-only run with the face forward, to tell an authorization problem from a positioning problem |

| 16 Nov | Director | Root cause of missing pulse: captured the frame the SDK sees (`probe/frame.mjs`, `videoOutput`) | **The camera is aimed low: the owner's face is cut off at the top-right edge.** The SDK pipeline is fine: native 1280x720 NV12; this HP camera has no AE lock, so auto exposure stays on (lighting matters). The frame was deleted after viewing (privacy) | Positioning problem, not authorization. Rerun with the face centred |

**Product lessons from this:**
1. The camera check must show the tester the camera view plus the SDK hint, and block "Start" until validation is OK for a few seconds.
2. Only the consenting tester may be in view (a second face blocks processing, and the consent screen says so).
3. Pulse needs 20 to 60 s to appear, because the model downloads on start (per the pulse-mirror README). Show "finding your pulse".
4. Disclosure: per the Presage docs, the SDK sends derived number summaries (no video) to Presage for an LLM wellness check-in, and this cannot be switched off. This goes in the consent screen and the post.

5. A probe run hit **kNetworkError** mid-session and produced nothing afterwards (matches the open SDK issue #18). The app must detect this and rebuild/restart the SDK while keeping the session; pulse-mirror does this.
6. If the camera is busy (e.g. the Windows Camera app is open), the SDK sits in "starting" (status 2) forever with no error. The app needs a start timeout that says "Your camera is in use by another app".
7. A face-centred run on 16 Nov gave pulse 79.6 BPM (2 samples, conf 15, first at ~127 s) and breathing stable from ~47 s (conf ~86). **Pulse is authorized but slow and weak on this laptop**, so the felt curve leans on expressions, talking, blinking and breathing, with pulse added only when confidence is high.

8. **Decision (16 Nov): camera ownership = renderer.** The SDK's native capture (`useCamera`, Media Foundation) on this HP camera stalls about 3 s shortly after start, possibly from its exposure-lock step. That throws `kTimestampGap` and processing status kError, and then `sdk.reset()` **blocks the event loop forever**. The renderer path (`getUserMedia` → `useMediaStream`) is what pulse-mirror uses on Windows, and our recorder spike already proved getUserMedia is steady at 30 fps. So recovery means destroy + rebuild the SDK instance (as pulse-mirror does), **never `reset()`**.

**Gotchas learned:**
- The permission handler must allow both `media` and `display-capture`.
- The electron postinstall may skip the binary download; fix with `node node_modules/electron/install.js`.
- TypeScript 7 has no `baseUrl`.
- Git Bash `timeout` cannot SIGINT a native Windows node process. Use the probe's `--seconds N` instead.

| 16 Nov | Sonnet | Renderer-path SDK integration + Sensor Test screen (timed protocol, JSONL log, destroy/rebuild recovery, camera-busy check) | The SDK loads in the sandboxed renderer: SDK preload via `session.registerPreloadScript`, plus `bindSmartSpectraIpc`. No kTimestampGap. **1280x720 → kSustainedLowFrameRate (error 14) every ~10 s; 640x480 steady 30 fps (now the default).** The forced rebuild returns to running in 1.6 s. Smoke runs had a black image (luma ~2), so 0 metrics | ACCEPTED as INTEGRATION PROVEN (no live metrics yet). Director re-ran typecheck, build and autotest; no `reset()` calls; telemetry off. Committed. UNVERIFIED: metrics on a real face at 640x480, metrics after a rebuild, preload under asar |

**Field mapping (from SDK `generated.d.ts`, via the probe):**
- pulse: `cardio.pulseRate[] {value, confidence, stable, timestamp}`
- breathing: `breathing.rate[]`
- HRV: `cardio.hrv[] {rmssd, meanNn, sdnn, baevsky}`
- blink and talking: `face.blinking[]` and `face.talking[]`, each `{detected, stable, timestamp}`
- expressions: `face.expression[] {scores[{type, confidence 0-100}]}`; types are ANGRY, CONTEMPT, DISGUST, FEAR, HAPPY, NEUTRAL, SAD, SURPRISE

Error codes: kAuthenticationFailed=2, kCreditExhausted=4, kMetricNotAuthorized=13.

## 12. Open questions / risks

1. The signals may not separate calm from tense (Phase 2 check 4). Fallback: weight the face signals and narrow the claim, or change direction.
2. Trial credits are unknown. Ask on Presage Discord and check plan usage via the MCP server.
3. Camera ownership: the main-process camera vs a renderer preview may conflict on Windows.
4. The 40 to 110 BPM cap and the 12/30/60 s windows mean beat-level spikes rely on face signals.
