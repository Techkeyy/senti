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
| Felt curve comes from live Presage signals | SDK `metrics` events → felt-intensity module | SDK on device | Live session log + video showing raw SDK values | session 20261117203123-oz9aau: 136 s of live samples → 8 startles | PROVEN (L4, n=1) |
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
| 2 Feasibility | probe: key works, face metrics authorized, credits, signal separation, camera + screen capture coexist | all 5 checks PASS with logged evidence | DONE 16 Nov (key, face metrics, coexist, startle separation PASS; pulse authorized but unreliable on owner laptop; credits: no errors seen) |
| 3 Vertical slice | one playtest end to end (ugly UI ok): curve → session → report with real signals | Core Outcome observed once | DONE 17 Nov 21:31: Core Outcome observed (face 100%, 8 startles, 3 mismatches) |
| 4 Product shell | design skill: real UI, four states, copy | first-time-user pass | PENDING |
| 5 Failure/recovery | camera lost, no face, key invalid, credits exhausted, app restart mid-session, delete | critical-bug red-team pass | PARTIAL: SDK rebuild recovery, worker crash, recorder retry, video retry and range crash fixed; red-team pass not run |
| 6 Package | Windows installer on GitHub Releases | fresh-machine install runs | PENDING |
| 7 UAT | owner runs the full journey from the installer | owner PASS | PENDING |
| 8 Submission | README (perfect-readme), demo video (demo-video), DEV post, consent section | all hackathon gates | PENDING |

**Halfway checkpoint:** by **19 Nov 23:59 UTC**, Phase 3 must be done. If not, cut scope.

**Frozen plan after the external review (17 Nov). No new features; the felt model is frozen.**
| When | Gate |
| --- | --- |
| 17 Nov | Lighter playtest on the owner laptop. PASS = face in ≥80% of play seconds AND startles detected at the scares |
| 17 to 18 Nov | Second-person playtest (n=2) |
| 18 Nov | Windows installer + GitHub Release, fresh-install test (risk: SDK native runtime + utilityProcess worker under asar) |
| 19 Nov | HALFWAY: installer works + one clean real session exists, else cut polish |
| 19 Nov | Design polish pass (one day max) |
| 20 Nov | README (perfect-readme, incl. break-it table, n=2, hardware limit) + critical-bug red-team + audit |
| 21 Nov | Demo video + DEV post with the consent section |
| 22 Nov | Owner UAT from the installer, then submit (a day early) |

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
| Public repo + setup instructions | https://github.com/Techkeyy/senti (public, created 17 Nov; key scan of full history: 0 matches) | Repo PASS, setup instructions PENDING (README) |
| Demo video showing the live signal | | PENDING |
| DEV post from the template, tags `devchallenge, presagechallenge` | | PENDING |
| Consent and Data Handling section (storage, retention, deletion, telemetry, AI use) | | PENDING |
| No medical claims, no covert monitoring | | PENDING (copy review) |
| Prize categories noted (enter both) | | PENDING |
| Optional: agent session embed | | PENDING |

## 9. Current status

**BUILDING: CORE OUTCOME PROVEN (L4) on the owner laptop, 17 Nov 21:31 local (session 20261117203123-oz9aau).** Play: face 136/136 s, 29.8 pkt/s, 0 restarts, no gaps; baseline 44/44. The felt model found 8 startles (strong at 0:26, 0:41, 1:21, 2:04), 9 voice reactions and 3 correct-looking mismatches against the default curve. Fixes that made it work: preview listener only in check, PRIORITY_HIGH worker, light recording, credits restored to 1000. **Open gates:** n=2 session, demo curve matched to the video, editor beat-label clip, README, red-team + audit, camera flow on the installed build, demo video, DEV post.

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

9. **Black image root cause (SDK issue #19):** the renderer SDK locks exposure, white balance and focus to manual and never restores them, so the camera stayed frozen dark (luma 2 to 7). Fix (`src/renderer/src/sensing/camera.ts` `cameraAuto`): set `continuous` modes after getUserMedia, wait 1.5 s, reapply if luma < 25, and restore before stopping. After the fix: luma ~101 and 702 metrics in 40 s (expressions 86% neutral, blinks).
10. **Low light reduces fps.** In auto exposure this room needed exposureTime 10000 (about 1 s), so fps fell to 10 to 20, giving kFrameRateTooLow and kSustainedLowFrameRate (2 rebuilds in 40 s). No pulse or breathing at that fps. **Real requirement: a lit face.** The camera check must measure fps and luma and say "Add light in front of you" before allowing Start.

11. **Hardware limit (owner laptop: i5-7300U, 2 cores, 2017).** Baseline CPU ~20% busy. With a face in view and cardio requested:
    - renderer path: ~15 to 20 fps;
    - native path: ~17 to 22 fps.

    The SDK stops with kSustainedLowFrameRate about every 30 s; rebuilding recovers each time (`probe/native-soak.mjs`: 6 rebuilds in 3 min; pulse 73 to 90, conf up to 63). **Face-only metrics: 0 restarts in 60 s at ~20 fps.** Native at 640x480: 26 fps at first, then a timestamp-gap stall and dark exposure after the rebuild.
12. **Decision (16 Nov): face-led felt curve.** Felt intensity is built from expressions (fear/surprise/non-neutral vs baseline), blink suppression and talking bursts. These run on modest PCs and react to individual beats. Pulse, breathing and HRV are added when the machine sustains them (the Presage Device Readiness check plus observed fps), and the UI says which signals are active. Requesting only the used metrics (no traces) also cut load.

13. **Separation test #1 (16 Nov, face-only native, rest 60 / calm 180 / tense 180): NOT PROVEN.**
    - Segment means: NEUTRAL 12/11/17, FEAR 21/29/19, SURPRISE 62/54/53, SAD 4/5/9, talking 0.24/0.58/0.07, blinks ~0/min (detection not working at ~20 fps).
    - Expressions are biased for this face and lighting: ~60% "surprise" at rest.
    - Confounds: a second face was in view during calm ("only one face allowed"), so the talking difference is unreliable. Block averages also hide second-long scares, and no time series was saved.
    - Gate status: **FAIL / inconclusive.** One clean rerun is allowed with a per-second time series and pre-registered criteria (below). If it fails, pivot.
    - **Pre-registered criteria for rerun:** PASS if (a) a combined arousal score (non-neutral + fear + surprise − rest baseline, or talking/silence) has a tense mean outside the calm mean ± 2 SD of its 10-s windows, OR (b) the per-second trace shows visible spikes during tense that are absent in calm (≥3 spikes > calm p95, each lasting 1 s or more). Otherwise FAIL.

14. **Rethink (16 Nov, owner asked).** Candidates scored under the proven constraints:
    - **A. Senti re-based on behaviour** (startle = landmark-speed spike, freeze = stillness, look-away = face turned/lost, vocal reaction = talking burst; expressions and pulse are extras).
    - B. Camera-only meeting talk-time: lost because a mic does it better.
    - C. Trailer reaction tester: lost because Ad Pulse Lab already did it.
    - D. Posture coach: lost because it is crowded and not novel.

    **Recommended: A**, gated by a pre-registered startle test: during jump scares, ≥3 per-second head-motion spikes above the calm p99, and ≤1 in calm. If it FAILS, drop Senti entirely and re-run the research.

15. **Startle test (16 Nov, `probe/startle.mjs`, native face-only, settle 20 / calm 90 / tense 90): PASS.** Pre-registered rule met:
    - threshold (calm p99) 1.03 face-widths/s; spike events calm 1 vs **tense 11**;
    - head speed median 0.19 vs 0.49, p90 0.49 vs 2.33, max 1.56 vs 9.17;
    - talking 0.12 vs 0.58; fear 10.7 vs 17.0; 1 rebuild, recovered.

    Limit: n = 1 person, one session (state this in the README). **The load-bearing assumption is proven for the behaviour-based felt curve.** The trace is in `probe/logs/` (gitignored).

16. **First UAT attempt (17 Nov): recorder failed.**
    - Attempt 1: AbortError. The display-media handler could not find the saved window id, so it called `callback({})`.
    - Attempt 2: the window was found, but "The recorder did not start". Root-caused with isolated tests:
      - capture of a window covered by another window gives ~4 frames in 5 s;
      - with Presage processing a face (separate process), full-HD screen capture starves (2 chunks in 6 s), 1280x720@10 gives 7, and **960x540@8 fps at 1 Mbps gives 10 (healthy)**;
      - with Presage idle, full HD is healthy.
    - Presage in a separate Node process ran 27 to 30 fps with 0 restarts, the best yet.
    - **Decisions:**
      - (a) run sensing in an Electron `utilityProcess`, off the main thread;
      - (b) record the **entire primary screen** at 960x540, 8 fps, 1 Mbps. Remove the window picker; Senti minimizes itself at play start and restores at stop. Consent copy now says the screen is recorded during play.
      - (c) wait for the first data chunk (up to 15 s) before declaring failure.

17. **Recorder fix shipped (17 Nov, commit 3f07d6c).**
    - Sensing now runs in a utilityProcess (`src/main/sensing-worker.ts`).
    - Recording is the whole primary screen at 960x540, 8 fps, 1 Mbps; the window picker is removed; Senti minimizes at play start and restores at stop.
    - Recording counts as started only on the first data chunk (timeout raised to 30 s by the director after a measured 10.7 s cold start); Retry skips consent, camera check and baseline.
    - Builder selftests: 6 runs, 7 to 9 chunks per 10 s. Director re-ran it: 9 chunks, 191 KB, pass.
    - UNVERIFIED: the full app flow with a face in view (next: owner UAT).

18. **UAT attempt 2 (17 Nov): flow completed (3:00 played, saved, report shown), but there were two defects.**
    - **(a) Felt curve flat.** Face packets were ~0.3/s in play (vs ~28/s in the probe). A/B in the probe: adding a no-op `videoOutput` listener dropped face fps from ~27 to ~5 and caused a restart (one clean pair; a repeat was invalid because the owner had left). Fix (commit after 3f07d6c): register videoOutput only in phase 'check', deleting it from the SDK's private `_listeners` Map otherwise (pinned 3.5.0 has no off()). **CONFIRMED 17 Nov: worker selftest with face in view gives faceSeconds 41/45 (before: 3/40), 0 restarts, 29 preview frames.**
    - **(b) "Recording could not be played" on the first report after save.** The file is valid (ffprobe and direct playback OK); reopening the report from the list plays fine (duration 180 s, seek OK), verified via CDP. Not reproducible on demand. Fix: log `SENTI_VIDEO_ERROR` with the code and retry once after 1.5 s before showing the error.

19. **UAT attempt 3 (17 Nov).**
    - **Report crash:** Senti logged `SENTI_VIDEO_ERROR code=2 PIPELINE_ERROR_READ: FFmpegDemuxer: data source error`, then the main process exited. Root cause: Node `Readable.toWeb` streams in `senti-media://` break when the player cancels a range during seeking. Fix: capped (4 MB) file reads, always 206. Storage selftest PASS (expectation updated); real recording primed and seeked 3 times via CDP with no error and the app still running.
    - **Data:** baseline face 34/36 at 27 pkt/s (the sensing fix works). Play face 11/54 at 8 pkt/s, 4 restarts, 102 s played. With YouTube full-screen HD + screen recording + Presage on 2 cores, Presage starves. This is a hardware/load limit, not a code bug.
    - Options for the owner: lighter content at lower resolution, lighter recording, a faster PC for the demo, and a stated system requirement.

20. **Design direction (17 Nov). The owner handed creative control to the director; decided and briefed to a builder (renderer only).**
    - Character: watchful, exact, a little dramatic.
    - World: a dark film-editing suite crossed with a heart monitor; the material is the line.
    - Ink-graphite surfaces; one ember accent for the felt trace and flinch marks; the intended curve is chalk dashed; mismatch zones are an ember wash.
    - Geist + Geist Mono bundled locally; lucide icons.
    - Signature: the flinch mark (spike + dot), used only for detected startles.
    - Moments: the tension timeline (report and home mini-curves) and live monitor traces (camera check, baseline, play).
    - Rationale for desktop recorded: Presage has no web SDK (iOS, Android, C++, Node/Electron only); the rules make public hosting optional; distribution = Windows installer on GitHub Releases.

21. **17 Nov afternoon.**
    - **Redesign committed** (04842b0); the director reviewed the screenshots. Known flaw: a beat label clips under the drag tooltip in the editor.
    - **Installer committed** (f651b66): NSIS 163 MB. The SDK loads from the installed app via `SMARTSPECTRA_CAPI_PATH` pointing at `app.asar.unpacked`. SENTI_PACKAGE_CHECK ok when unpacked and installed. Camera flow on the packaged build is UNVERIFIED.
    - **UAT attempt 4 (480p windowed + light recording):** play face 33/185 played seconds (18%), 6 pkt/s, 5 restarts, a 93 s gap. FAIL.
    - **Attempt 5 ("jumpscare 4", 2:04):** CORRECTED, it is a VALID run. The timestamps prove there was no overlap: play 12:39:35 to 12:41:39 UTC, and the director's lean test started ~12:45.
      - Result: 4 flinches detected; play face 13/124 s in two bursts; 0 to 14 pkt/s; 4 restarts with gaps.
      - Baseline at 20 to 31 pkt/s but face=false every second (likely "no face found", e.g. the owner looking away while setting up the video).
      - Verdict: still starved during video playback. FAIL on the 80% gate.
    - The lean-metrics test (landmarks+talking at 640x480, ~12:45, no overlap): 1 to 7 pkt/s, 2 restarts. Lean sensing did NOT help.
    - **Process rule:** never run camera tests while the owner may be using Senti.
    - **Conclusion so far:** on the owner laptop the SDK falls below its ~25 fps floor during video playback and self-stops. Decision pending: a clean lean test vs a faster PC for the demo.

22. **Owner: only this laptop is available (17 Nov).**
    - Measured pairs: Presage+video OK, Presage+recording OK, all three FAIL.
    - **Fix: the sensing worker runs at `PRIORITY_HIGH`** (`os.setPriority`, no admin needed). Probe under the full load (480p video + 640x360@5 recording + face-only): **30.0 pkt/s steady for 90 s, 0 restarts**, while the recording kept producing 6 to 8 chunks per run.
    - Committed; the worker reports priority -14 via SENTI_PACKAGE_CHECK.
    - Next: a real playtest in Senti to confirm the 80% face gate.

23. **BLOCKER (17 Nov ~15:15): Presage trial credits exhausted.**
    - The probe shows `kCreditExhausted` on every start.
    - The last playtest ("jump scare", 14:08) had 29.9 pkt/s and 0 restarts, but landmarks were frozen (speed 0 every second) and talking was absent, while expressions varied. Likely related to the credits running out. UNVERIFIED; treat that run as INVALID.
    - Fix shipped: fatal SDK errors (2 auth, 4 credits, 13 metric not authorized) stop rebuilding and show a plain message. Verified: state=error, 0 restarts (before: 15 rebuilds in 55 s).
    - **RESOLVED 17 Nov 18:43 local:** Presage (Bobby H, Discord #sdk-support DM) raised the credits to **1000**. Rule from Presage: credits are not consumed until metrics start, then 1 credit every 30 s (a 5-min session is about 11 credits; each SDK rebuild starts a new metrics stream). The director verified the key works again with a 30 s probe.
    - **Credit budget from now:** one clean playtest, the n=2 session and the demo recording. No more exploratory camera tests.

24. **Red-team audit (critical-bug skill, MODE A, 17 Nov evening): OVERALL FAIL, safe to demo from HEAD.**
    - P0 RB-1: the installer (13:55) predates PRIORITY_HIGH (14:01) and the fatal-error fix (15:17). Verified by the director.
    - P1:
      - B1: Cancel during recorder start leaks the recorder, hotkeys and minimize. The director verified the code.
      - B2: Retry then Cancel leaks the worker. The director verified the code.
      - B3: a worker crash or stop timeout silently saves empty data.
      - B4: no sensor gate before baseline/Ready.
      - B5: unbounded rebuild loop and no idle stop.
    - P2: menu/DevTools in prod, single instance, close mid-play, hotkey failure still minimizes, busy copy, error boundary, README/LICENSE/SDK redistribution check, consent storage/retention/telemetry copy.
    - **Approved fix list dispatched to a builder.** Do-not-touch: felt.ts, recorder params, priority approach.
    - After the fixes: rebuild the installer from HEAD, then a fresh-install full journey with the owner.

**Gotchas learned:**
- The permission handler must allow both `media` and `display-capture`.
- The electron postinstall may skip the binary download; fix with `node node_modules/electron/install.js`.
- TypeScript 7 has no `baseUrl`.
- Git Bash `timeout` cannot SIGINT a native Windows node process. Use the probe's `--seconds N` instead.

| 16 Nov | Sonnet | Renderer-path SDK integration + Sensor Test screen (timed protocol, JSONL log, destroy/rebuild recovery, camera-busy check) | The SDK loads in the sandboxed renderer: SDK preload via `session.registerPreloadScript`, plus `bindSmartSpectraIpc`. No kTimestampGap. **1280x720 → kSustainedLowFrameRate (error 14) every ~10 s; 640x480 steady 30 fps (now the default).** The forced rebuild returns to running in 1.6 s. Smoke runs had a black image (luma ~2), so 0 metrics | ACCEPTED as INTEGRATION PROVEN (no live metrics yet). Director re-ran typecheck, build and autotest; no `reset()` calls; telemetry off. Committed. UNVERIFIED: metrics on a real face at 640x480, metrics after a rebuild, preload under asar |

| 16 Nov | Director | Phase 3 contract: `src/shared/session.ts` (Session, SecondSample, Report, Mismatch...), new IPC channels, preload bridge, `src/main/settings.ts` (safeStorage key), owner stubs | typecheck + build pass | Committed aead26a |
| 16 Nov | Sonnet A | Main-process native sensing (`src/main/sensing.ts`) + felt model (`src/shared/felt.ts`) + Vitest, with a real-trace fixture test | 9/9 tests. Selftest: videoOutput preview works (46 frames in 10 s). The face rule requires a moving centre (the SDK sends frozen landmarks for an empty chair). Real trace: calm 0 / tense 4 startles (the jittery 12-s baseline pushed the threshold to ~3.9). EMA applies on decay only, so startles are not flattened | ACCEPTED, COMPONENT PROVEN. Director re-ran typecheck, tests and build. UNVERIFIED: live face values via main, ready flag with a face, recovery inside Electron |
| 16 Nov | Sonnet B | Renderer flow (key → home → new playtest + curve editor → consent → camera check → baseline → play + F8/F9 → save → report) + `src/main/sessions.ts` (storage, senti-media:// protocol with Range, hotkeys); remove the old renderer sensing | Storage round trip and Range 206/416/400 pass; seeking in the renderer passes (primeDuration fix for webm Infinity duration); screenshots in out/shots. vp8 at 2.5 Mbps to spare the CPU | ACCEPTED, COMPONENT PROVEN. The director reviewed the key, curve and consent screenshots, then removed the dead renderer-SDK/spike code (sensor.ts, spike IPC, saveRecording). UNVERIFIED: a full live play-through |

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
