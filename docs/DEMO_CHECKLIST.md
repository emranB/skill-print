# Demo checklist

Commands from repo root. Chrome or Chromium. Copy `.env.example` to `.env` with a real `ELEVENLABS_API_KEY` and the existing `ELEVENLABS_AGENT_ID`.

```
npm install
npm run dev
```

Open http://localhost:5173. Watch Debug / Logs (errors and summaries only; raw pose frames are hidden).

Marketing clips (36s each): `videos/skillprint-product.mp4` (page stills with copy) and `videos/skillprint-tech.mp4` (live teach then learn). See `docs/PRODUCT.md`.

## A. Prerecorded expert video (Level B)

1. Capture: **Upload video**. The Apprentice defaults to **ElevenLabs** when the server has credentials (the side panel says whether it is online). Mock works offline but cannot classify teaching.
2. Choose `data/lesson-squat.mp4`, then **Use this video**. Upload skips camera calibration.
3. Name the lesson, Continue, then **Analyze this video**. Progress shows transcription, pose reading as a percentage (about 50 s), then the Apprentice studying the lesson. **Download video** saves a copy.
4. Answer the Capture Review questions, then the Debrief follow-ups.
5. In teach-back, keep, correct or remove each item, then confirm.
6. Expected Work Map: the expert's own sentences quoted with times, ALIGNED or PARTIAL tags with geometry notes, your answers with their questions, and only guardrails you named.

Automated: `npm run test:level-b` (writes `test-results/level-b-semantic-report.json`).

## B. Live camera (Level A, manual)

1. Capture: **Camera**. Allow camera and mic when prompted.
2. Teach calibration draws your skeleton on the camera feed: green joints are tracked, red dashed bones and hollow rings are joints the camera cannot see yet, and a framing guide names them with a hint. Once your whole body has been tracked for about 1 s, Continue unlocks and stays unlocked through brief dropouts. If the mic is denied, tick **Continue video only**. If the camera is denied, switch to Upload.
3. The Ready screen keeps the skeleton on so you can frame yourself. Start recording. The line under the preview should read `Pose tracking: running, N frames recorded` with N rising while you are in view.
4. With Apprentice **ElevenLabs**, the voice session starts on the Ready screen. While recording, the side panel shows "Mic closed while you teach". About 8 s in, the card on the video reads "Apprentice is asking", the apprentice speaks one short question, and the mic tag switches to "Mic open for your answer". Answer aloud; the card counts answers noted. At most three questions per recording.
5. Stop. **Download video** saves the recording. Then Analyze. In Capture Review, spoken questions come first with the tag "Asked aloud while you recorded" and your answer pre-filled.

## C. ElevenLabs Apprentice voice (manual)

1. Apprentice: **ElevenLabs**. Click **Start Apprentice** in the side panel and allow the mic.
2. Status goes Connecting, then Connected, then Listening or Speaking.
3. Cancel or Home ends the session (status Disconnected). Finish Lesson and switching to Mock do the same.

## D. Learn mode

1. Home, Learn a Skill, pick the saved lesson.
2. Calibration, then answer the prediction question. The Apprentice writes it from the lesson, together with per phase coaching cues, once before practice. Begin attempt.
3. Camera: `Pose tracking: running` appears. Your green skeleton and the orange teacher ghost (lesson checkpoint geometry, scaled to your body) are drawn on your camera feed. Coaching names the body part that is furthest off, for example "Bring your left knee higher", plus the expert's cue for that phase. The line `Checkpoint N of 9, match X%, reps R` updates as you move. Stepping out of view shows a prompt to step back in and never counts a rep.
4. Pose Fixture: replays student-good at a 6 s rep pace (one rep); tick student-bad to see corrections and no rep.
5. Finish Lesson shows the MasteryReport.

## E. Offline fallback (no camera, no paid API)

1. Capture: **Pose fixture**. Apprentice: **Mock**.
2. Teach a Skill, calibration auto-passes, capture reference, Start (fixture replays), Analyze, answer questions, confirm teach-back, Submit.
3. Learn as in D.

Automated: `npm run verify` and `npm run test:e2e`

## Docker

```
docker compose build
docker compose up
```

http://localhost:8000 (API and built UI, same port). To use another host port: `SKILLPRINT_HOST_PORT=8100 docker compose up`.

Against the running container: `SKILLPRINT_BASE_URL=http://localhost:8000 npm run test:e2e`.

`/api/apprentice/structured` (40 per minute), `/api/elevenlabs/session` (20) and `/api/transcribe` (10) are rate limited per client address and answer 429 with Retry-After. Set `TRUST_PROXY` only behind a reverse proxy.
