# IMPLEMENTATION_STATUS.md

Living development handoff. Do not duplicate architecture here. See `docs/PROJECT_PLAN.md` and `docs/DATA_CONTRACTS.md`.

## Current

| Field | Value |
|-------|--------|
| Phase | Production-ready MVP |
| Status | Teach (live, upload, fixture) and Learn (ghost coaching) run end to end. Marketing clips in `videos/`. |
| Apprentice model | ElevenLabs agent from `.env`. Same voice and prompt. No other provider |

## How semantic learning works

1. Scribe transcript is split into teaching units at sentence and pause boundaries (`transcriptToUnits`).
2. The server sends batches of units to the existing agent over a text-only conversation (`/api/apprentice/structured`). The agent returns kind plus statement for each teaching point. The reply is validated with Zod on the client before it reaches state. If the agent is unreachable, units become `unknown` statements with `unclassified_fallback`.
3. Each statement is aligned to geometry measured before, during and after it (`alignStatements`), giving `StatementEvidence` with ALIGNED, PARTIAL or UNALIGNED. Verbal-only teaching is kept.
4. Capture Review and Debrief questions come from knowledge gaps (why, judgment, boundary, exception, attention, failure, uncertainty). The agent only phrases them and may drop redundant ones. The failure gap is always kept.
5. During a live camera recording with the ElevenLabs apprentice, `LiveInterviewer` asks up to three spoken clarifying questions (why, attention, failure, boundary). The app picks the gap and timing and describes recent motion from pose data; the agent only phrases the question. The mic is muted except while the expert answers. Answers become pre-filled Capture Review questions (`askedLive`), and the interview windows are removed from the narration transcript before extraction.
6. Teach-back is built from narration plus answers. The expert keeps, corrects or removes each item. Only kept or corrected items are compiled.
7. Provenance keeps `transcriptText` (verbatim speech only), question and answer, evidence window, geometry, confidence and a source class (EXPLICIT_TEACHING, EXPERT_ANSWER, CONFIRMED_TEACH_BACK).

## Level B evidence (`data/lesson-squat.mp4`, real MediaPipe, real Scribe, real agent)

Command: `npm run test:level-b`. 8 of 8 passed. Report: `test-results/level-b-semantic-report.json`.

| Item | Result |
|------|--------|
| Pose | 994 frames, 0 to 66200 ms, monotonic, finite |
| Segmentation | Rest found from dwell (10.7 s). 3 regimes. 6 complete cycles plus 1 opening fragment |
| Extraction | 16 statements, all model-classified |
| Coverage | 16 of 16 hand-listed teaching points covered. 6 of 6 demonstrated points ALIGNED |
| Capture Review | 6 questions including a grounded failure (guardrail) question |
| Debrief | 4 follow-ups, none repeating capture questions |
| Timing | Pose and segmentation 50.9 s alone (was 57.4 s), extraction about 3 s, capture about 2.5 s, debrief about 2.7 s, teach-back about 3.8 s |

Expert answers, demonstration labels and teach-back confirmation in automated runs are typed by the harness and flagged SIMULATED TEST RESPONSE. Narration items are real.

## Browser runs (AUTOMATED CHROMIUM FAKE-MEDIA PASS, not a real camera)

`tests/level-b/live-flows.spec.ts` replays seconds 7 to 22 of the sample video as the webcam.

| Path | Result |
|------|--------|
| Live Teach | Calibration stays lost until a pose arrives, then valid (12 of 12 joints). 45 frames recorded, about 1 MB WebM downloaded before submit |
| Teach to Home | All camera and mic tracks ended, every pose loop stopped |
| Upload Teach through the UI | Real extraction, Scribe and agent. 6 capture and 4 debrief answers, teach-back correct, remove and keep, Work Map checked in the page (9 checkpoints, quoted narration, replay seeks to the clip start) |
| Reload | Stored lesson read back from IndexedDB with schemaVersion 1, 9 checkpoints, narration, answers, guardrail, corrected item and tracking profile |
| Live Learn | Ghost from lesson checkpoints plus student skeleton, 130+ frames tracked, all 9 checkpoints passed, 1 rep, 3 coaching cues, MasteryReport, devices released |
| Teach after Learn | Fresh calibration and empty setup, no duplicate events |
| Voice | Two real sessions opened; Cancel to Home and the switch to Mock each close the socket and the mic |

`tests/e2e/error-paths.spec.ts` (offline): camera denied, mic denied with video only, empty camera never passes the body check, voice session failure, invalid upload, Scribe failure without invented narration, damaged stored lesson.

## Tests executed

- `npm run verify`: typecheck, lint, 80 unit tests
- `npm run test:e2e`: 11 passed
- `npm run test:level-b`: 8 passed
- `docker compose build` and `up`: app on http://localhost:8000, apprentice health reports configured plus defaultMode

## Security

- API key is server-only. Not found in `dist`, test results, docs, source or tests. No `VITE_` variables.
- Wildcard CORS removed; nothing needs cross-origin access.
- Signed URLs are not logged. Structured task inputs are size-capped with Zod. Rate limit logs show route and client address only.

## Remaining

| Item |
|------|
| Model may file a non-warning answer as a warning; the expert can correct or remove it in teach-back |
| The canonical movement is a median over every demonstration, so a lesson filmed from several angles matches a single-angle student less closely. Raise leniency in the side panel if needed |
