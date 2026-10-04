# FILE_INDEX

Every explicit path in the canonical repository tree. Status: PLANNED | IMPLEMENTED | TESTED.

Binary files that do not yet genuinely exist remain PLANNED. Application/source files remain PLANNED until implemented.

---

## README.md

Status: IMPLEMENTED

- Product front page with films, stills, then run/dev/Docker

## run.sh

Status: IMPLEMENTED

- Local cleanup then `npm run dev`. Does not run Docker Compose.

## docs/PRODUCT.md

Status: IMPLEMENTED

- Page-by-page product copy matching the marketing videos

## docs/PROJECT_PLAN.md

Status: IMPLEMENTED

- Primary product/architecture/gates/DoD source of truth

## docs/DATA_CONTRACTS.md

Status: IMPLEMENTED

- Authoritative TypeScript/Zod contract shapes

## docs/FILE_INDEX.md

Status: IMPLEMENTED

- Repository and symbol inventory

## docs/IMPLEMENTATION_STATUS.md

Status: IMPLEMENTED

- Living gate status and handoff

## config.json

Status: IMPLEMENTED

- Runtime defaults (thresholds, feature flags)

## package.json

Status: IMPLEMENTED

- npm scripts, dependencies, and project metadata

## package-lock.json

Status: IMPLEMENTED

- Locked dependency tree for reproducible installs

## tsconfig.json

Status: IMPLEMENTED

- Client TypeScript project settings

## tsconfig.server.json

Status: IMPLEMENTED

- Server TypeScript compile output settings

## vite.config.ts

Status: IMPLEMENTED

- Vite dev server, client build, fixture static copy

## vitest.config.ts

Status: IMPLEMENTED

- Vitest unit test runner configuration

## playwright.config.ts

Status: IMPLEMENTED

- Playwright e2e runner configuration

## eslint.config.js

Status: IMPLEMENTED

- ESLint flat config for client and server TypeScript

## .prettierrc

Status: IMPLEMENTED

- Prettier formatting rules

## .gitignore

Status: IMPLEMENTED

- Ignores secrets, dependencies, build output, test artifacts, and local agent notes

## .dockerignore

Status: IMPLEMENTED

- Docker build context exclusions

## .env.example

Status: IMPLEMENTED

- Documented environment variable template

## Dockerfile

Status: IMPLEMENTED

- Production image: build client+server, serve on 8000

## docker-compose.yml

Status: IMPLEMENTED

- Single-service compose for production-style run

## public/models/pose_landmarker_full.task

Status: IMPLEMENTED

- MediaPipe pose landmarker task (~9.4MB) on disk

## fixtures/motion-cycle-a/teacher.pose.json

Status: TESTED

- Fixture data; Level C JSON or Level B media per `docs/PROJECT_PLAN.md`

## fixtures/motion-cycle-a/student-good.pose.json

Status: TESTED

- Fixture data; Level C JSON or Level B media per `docs/PROJECT_PLAN.md`

## fixtures/motion-cycle-a/student-bad.pose.json

Status: TESTED

- Fixture data; Level C JSON or Level B media per `docs/PROJECT_PLAN.md`

## fixtures/motion-cycle-a/expected.json

Status: IMPLEMENTED

- Fixture data; Level C JSON or Level B media per `docs/PROJECT_PLAN.md`

## fixtures/motion-cycle-b/teacher.pose.json

Status: IMPLEMENTED

- Fixture data; Level C JSON or Level B media per `docs/PROJECT_PLAN.md`

## fixtures/motion-cycle-b/student-good.pose.json

Status: IMPLEMENTED

- Fixture data; Level C JSON or Level B media per `docs/PROJECT_PLAN.md`

## fixtures/motion-cycle-b/student-bad.pose.json

Status: IMPLEMENTED

- Fixture data; Level C JSON or Level B media per `docs/PROJECT_PLAN.md`

## fixtures/motion-cycle-b/expected.json

Status: IMPLEMENTED

- Fixture data; Level C JSON or Level B media per `docs/PROJECT_PLAN.md`

## data/lesson-squat.mp4

Status: TESTED

- Narrated Level B teaching MP4 used by `npm run test:level-b`
- Filename must not influence production analysis (served as generic upload)

## fixtures/squat/teacher.mp4

Status: PLANNED

- Genuine binary asset required when used; never empty placeholder

## fixtures/squat/teacher.pose.json

Status: IMPLEMENTED

- Fixture data; Level C JSON or Level B media per `docs/PROJECT_PLAN.md`

## fixtures/squat/transcript.json

Status: IMPLEMENTED

- Fixture data; Level C JSON or Level B media per `docs/PROJECT_PLAN.md`

## fixtures/squat/student-good.mp4

Status: PLANNED

- Genuine binary asset required when used; never empty placeholder

## fixtures/squat/student-good.pose.json

Status: IMPLEMENTED

- Fixture data; Level C JSON or Level B media per `docs/PROJECT_PLAN.md`

## fixtures/squat/student-bad.mp4

Status: PLANNED

- Genuine binary asset required when used; never empty placeholder

## fixtures/squat/student-bad.pose.json

Status: IMPLEMENTED

- Fixture data; Level C JSON or Level B media per `docs/PROJECT_PLAN.md`

## fixtures/squat/expected.json

Status: IMPLEMENTED

- Fixture data; Level C JSON or Level B media per `docs/PROJECT_PLAN.md`

## fixtures/pushup/teacher.mp4

Status: PLANNED

- Genuine binary asset required when used; never empty placeholder

## fixtures/pushup/teacher.pose.json

Status: IMPLEMENTED

- Fixture data; Level C JSON or Level B media per `docs/PROJECT_PLAN.md`

## fixtures/pushup/transcript.json

Status: IMPLEMENTED

- Fixture data; Level C JSON or Level B media per `docs/PROJECT_PLAN.md`

## fixtures/pushup/student-good.mp4

Status: PLANNED

- Genuine binary asset required when used; never empty placeholder

## fixtures/pushup/student-good.pose.json

Status: IMPLEMENTED

- Fixture data; Level C JSON or Level B media per `docs/PROJECT_PLAN.md`

## fixtures/pushup/student-bad.mp4

Status: PLANNED

- Genuine binary asset required when used; never empty placeholder

## fixtures/pushup/student-bad.pose.json

Status: IMPLEMENTED

- Fixture data; Level C JSON or Level B media per `docs/PROJECT_PLAN.md`

## fixtures/pushup/expected.json

Status: IMPLEMENTED

- Fixture data; Level C JSON or Level B media per `docs/PROJECT_PLAN.md`

## src/backend/index.ts

Status: IMPLEMENTED

- Implemented application module

## src/backend/config/env.ts

Status: IMPLEMENTED

- Implemented application module

## lessons/

Status: IMPLEMENTED

- One JSON file per saved lesson, loaded when the app starts

## src/backend/lessons/lessonStore.ts

Status: IMPLEMENTED

- Reads and writes `lessons/<id>.json`

## src/backend/routes/lessons.ts

Status: IMPLEMENTED

- List, read, save, and delete lesson files

## src/backend/routes/health.ts

Status: IMPLEMENTED

- Implemented application module

## src/backend/routes/config.ts

Status: IMPLEMENTED

- Implemented application module

## src/backend/routes/transcribe.ts

Status: IMPLEMENTED

- Implemented application module

## src/backend/routes/elevenlabs.ts

Status: IMPLEMENTED

- Implemented application module

## src/backend/services/ElevenLabsServer.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/main.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/styles.css

Status: IMPLEMENTED

- Implemented application module

## src/frontend/app/App.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/app/AppMachine.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/app/AppContext.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/app/app.types.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/app/actions.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/clock/SessionClock.ts

Status: IMPLEMENTED

- `SessionClock`
- `RealSessionClock`
- `FakeSessionClock`

## src/frontend/clock/clock.types.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/calibration/CalibrationFlow.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/calibration/CalibrationMonitor.ts

Status: TESTED

- `CalibrationMonitor`
- `update(frame, signals): CalibrationState`
- Per-metric valid/degraded/lost with independent recovery


## src/frontend/calibration/MicrophoneCalibration.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/calibration/BodyCalibration.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/calibration/calibration.types.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/media/MediaSource.ts

Status: IMPLEMENTED

- `MediaSource`

## src/frontend/media/LiveMediaSource.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/media/UploadedMediaSource.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/media/ReplayMediaSource.ts

Status: IMPLEMENTED

- `ReplayMediaSource`
- Builds TeachingMedia(poseRecording) for fixture replay into analyzeTeachingSession

## src/frontend/media/CameraManager.ts

Status: IMPLEMENTED

- `CameraManager`
- `acquire(options): Promise<MediaStream>`
- `getVideoStream(): MediaStream | null`
- `getAudioStream(): MediaStream | null`
- `releaseAudio(): void`
- `releaseAll(): void`

## src/frontend/media/VideoRecorder.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/media/MomentPlayer.ts

Status: PLANNED

- Implemented application module

## src/frontend/media/media.types.ts

Status: IMPLEMENTED

- `TeachingMedia` and media adapter types (video and/or poseRecording; Zod: at least one required)

## src/frontend/pose/PoseDetector.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/pose/PoseRecorder.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/pose/PoseNormalizer.ts

Status: TESTED

- `normalizePose(...)`
- `computeBodyScale(...)`

## src/frontend/pose/PoseGeometry.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/pose/PoseDistance.ts

Status: TESTED

- `poseDistance(...)`

## src/frontend/pose/PoseSegmenter.ts

Status: TESTED

- `PoseSegmenter`
- `captureReference(frames): NormalizedPose`
- `update(frame): SegmentationEvent[]`

## src/frontend/pose/PoseComparator.ts

Status: TESTED

- `comparePose(...)`

## src/frontend/pose/PoseRenderer.ts

Status: IMPLEMENTED

- Skeleton drawing with spine, head, hands and feet; display-only pose easing

## src/frontend/pose/pose.types.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/teach/TeachFlow.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/teach/SkillSetup.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/teach/RecordingControls.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/teach/RecordingReview.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/teach/TeachingSession.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/teach/teach.types.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/analyze/SessionAnalyzer.ts

Status: TESTED

- `analyzeTeachingSession(media, context): Promise<SessionAnalysis>`
- Extracts poses from video via VideoPoseExtractor when poseRecording absent

## src/frontend/analyze/VideoPoseExtractor.ts

Status: TESTED

- Offline MediaPipe IMAGE-mode extraction from uploaded video blobs

## src/frontend/analyze/transcribeClient.ts

Status: TESTED

- Browser client for `POST /api/transcribe` (no API key in browser)

## src/scripts/level-b/runLevelBPipeline.ts

Status: TESTED

- Browser harness calling production upload/analyze/transcribe/compile path

## src/frontend/analyze/GeometrySummarizer.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/analyze/CycleAnalyzer.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/analyze/QuestionBuilder.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/analyze/TimelineAligner.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/analyze/analyze.types.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/apprentice/ApprenticeProvider.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/apprentice/ApprenticeGateway.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/apprentice/MockApprenticeGateway.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/apprentice/ElevenLabsGateway.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/apprentice/ApprenticeTools.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/apprentice/ApprenticeEvents.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/apprentice/prompts/analyzeLesson.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/apprentice/prompts/reviewLesson.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/apprentice/prompts/coachStudent.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/review/ReviewFlow.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/review/QuestionReview.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/review/Debrief.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/review/LessonReview.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/review/LessonEditor.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/lesson/LessonCompiler.ts

Status: TESTED

- Implemented application module

## src/frontend/lesson/CanonicalMovementBuilder.ts

Status: TESTED

- `buildCanonicalMovement(demonstrations): CanonicalMovement`

## src/frontend/lesson/LessonSchema.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/lesson/LessonCard.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/lesson/LessonMap.tsx

Status: IMPLEMENTED

- `LessonMap` (clickable Work Map)
- Ordered checkpoints, knowledge, reasons, guardrails, evidence moments
- Selecting evidence replays the expert moment

## src/frontend/lesson/lesson.types.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/learn/LessonLibrary.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/learn/LearnFlow.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/learn/StudentCalibration.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/learn/GhostCoach.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/learn/TrajectoryTracker.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/learn/CheckpointTracker.ts

Status: TESTED

- `CheckpointTracker`
- `update(pose): CheckpointTrackerEvent | null`
- `reset(): void`

## src/frontend/learn/CoachingSession.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/learn/SuccessOverlay.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/learn/MasteryReport.tsx

Status: IMPLEMENTED

- `MasteryReport`
- End-of-practice report for LEARN_COMPLETE (reps, corrections, common issue, guardrails, Done)

## src/frontend/storage/IndexedDb.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/storage/LessonRepository.ts

Status: IMPLEMENTED

- `LessonRepository`
- `list()`, `get(id)`, `save()`, `delete()`
- Loads and writes `lessons/<id>.json` through the API
- `save(lesson)`
- `delete(id)`

## src/frontend/storage/SessionRepository.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/storage/storage.types.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/config/RuntimeConfig.ts

Status: IMPLEMENTED

- `RuntimeConfigManager`
- `load()`
- `get()`
- `update(...)`
- `resetOverrides()`

## src/frontend/config/ConfigPanel.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/debug/DebugBus.ts

Status: IMPLEMENTED

- `DebugBus`
- `emit(event): void`
- `subscribe(listener): () => void`
- `exportTrace(options?): string`

## src/frontend/debug/DebugConsole.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/debug/DebugEventRow.tsx

Status: IMPLEMENTED

- Implemented application module

## src/shared/debug/DebugExporter.ts

Status: IMPLEMENTED

- Implemented application module

## src/shared/debug/debug.types.ts

Status: IMPLEMENTED

- Implemented application module

## src/frontend/components/CompanyMark.tsx

Status: IMPLEMENTED

- Small Bluethumb Technologies credit on the home header

## src/frontend/components/LandingPage.tsx

Status: IMPLEMENTED

- Home landing page with product copy, actions, and saved lessons

## src/frontend/components/SkeletonScene.tsx

Status: IMPLEMENTED

- Landing illustration of the student skeleton and teacher ghost

## src/frontend/components/MainWorkspace.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/components/VisualPanel.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/components/ApprenticePanel.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/components/SkeletonCanvas.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/components/VideoViewport.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/components/StatusBadge.tsx

Status: IMPLEMENTED

- Implemented application module

## src/frontend/components/Modal.tsx

Status: IMPLEMENTED

- Implemented application module

## src/shared/utils/math.ts

Status: IMPLEMENTED

- Implemented application module

## src/shared/utils/time.ts

Status: IMPLEMENTED

- Implemented application module

## src/shared/utils/id.ts

Status: IMPLEMENTED

- Implemented application module

## tests/unit/PoseNormalizer.test.ts

Status: IMPLEMENTED

- Passes under `npm run test` or `npm run test:e2e`

## tests/unit/PoseDistance.test.ts

Status: IMPLEMENTED

- Passes under `npm run test` or `npm run test:e2e`

## tests/unit/PoseSegmenter.test.ts

Status: IMPLEMENTED

- Planned test; see `docs/PROJECT_PLAN.md` acceptance criteria

## tests/unit/PoseComparator.test.ts

Status: IMPLEMENTED

- Planned test; see `docs/PROJECT_PLAN.md` acceptance criteria

## tests/unit/CanonicalMovementBuilder.test.ts

Status: IMPLEMENTED

- Planned test; see `docs/PROJECT_PLAN.md` acceptance criteria

## tests/unit/CalibrationMonitor.test.ts

Status: IMPLEMENTED

- Planned test; see `docs/PROJECT_PLAN.md` acceptance criteria

## tests/unit/CheckpointTracker.test.ts

Status: IMPLEMENTED

- Planned test; see `docs/PROJECT_PLAN.md` acceptance criteria

## tests/unit/LessonCompiler.test.ts

Status: IMPLEMENTED

- Planned test; see `docs/PROJECT_PLAN.md` acceptance criteria

## tests/e2e/home.spec.ts

Status: IMPLEMENTED

- Planned test; see `docs/PROJECT_PLAN.md` acceptance criteria

## tests/e2e/calibration.spec.ts

Status: PLANNED

- Planned test; see `docs/PROJECT_PLAN.md` acceptance criteria

## tests/e2e/teach-upload.spec.ts

Status: PLANNED

- Planned test; see `docs/PROJECT_PLAN.md` acceptance criteria

## tests/e2e/teach-review.spec.ts

Status: PLANNED

- Planned test; see `docs/PROJECT_PLAN.md` acceptance criteria

## tests/e2e/learn-good.spec.ts

Status: PLANNED

- Planned test; see `docs/PROJECT_PLAN.md` acceptance criteria

## tests/e2e/learn-bad.spec.ts

Status: PLANNED

- Planned test; see `docs/PROJECT_PLAN.md` acceptance criteria

## tests/e2e/runtime-config.spec.ts

Status: IMPLEMENTED

- Planned test; see `docs/PROJECT_PLAN.md` acceptance criteria

## docs/DEMO_CHECKLIST.md

Status: IMPLEMENTED

- Manual Level A/B/C demo steps

## src/shared/config/config.types.ts

Status: IMPLEMENTED

- Shared runtime config contracts

## src/scripts/level-b/probe-level-b-media.mjs

Status: IMPLEMENTED

- Level B media probe harness (ffprobe)

## src/scripts/fixtures/generate-fixtures.mjs

Status: IMPLEMENTED

- Fixture generation helper

## src/scripts/fixtures/verify-fixtures.mjs

Status: IMPLEMENTED

- Fixture verification helper

## src/shared/utils/interval.ts

Status: IMPLEMENTED

- Half-open interval helpers used by every evidence window

## src/frontend/analyze/StatementAligner.ts

Status: IMPLEMENTED

- Aligns teaching statements to geometry before, during and after each statement

## src/frontend/analyze/TeachingEnrichment.ts

Status: IMPLEMENTED

- Runs extraction and alignment after analysis; extracts statements from expert answers

## src/frontend/apprentice/SemanticPipeline.ts

Status: IMPLEMENTED

- Zod-validated extraction, gap-driven Capture Review and Debrief, teach-back summary

## src/frontend/apprentice/ApprenticeVoice.tsx

Status: IMPLEMENTED

- Start Apprentice voice session with status and teardown
- Auto-connects for live teaching and follows the live interview mic policy

## src/frontend/apprentice/LiveInterview.ts

Status: IMPLEMENTED

- Spoken clarifying questions during live teaching, answer capture, transcript exclusion windows

## src/frontend/teach/LiveInterviewCard.tsx

Status: IMPLEMENTED

- Overlay on the live recording showing the current question and answers noted

## tests/unit/LiveInterview.test.ts

Status: IMPLEMENTED

- Interviewer ask, answer, timeout and mic policy; transcript window exclusion

## src/frontend/apprentice/voiceStatus.ts

Status: IMPLEMENTED

- Maps SDK connection state to user-facing voice statuses

## src/frontend/lesson/TeachBackItems.ts

Status: IMPLEMENTED

- Builds reviewable teach-back items with provenance

## src/frontend/review/TeachBackReview.tsx

Status: IMPLEMENTED

- Expert keeps, corrects or removes each teach-back item

## src/frontend/pose/LivePoseLoop.ts

Status: IMPLEMENTED

- Animation-frame pose loop with rate limit and backpressure

## src/frontend/pose/useLivePose.ts

Status: IMPLEMENTED

- React hook owning detector, offscreen video and loop lifetime

## src/backend/services/ApprenticeTextSession.ts

Status: IMPLEMENTED

- Signed URL and text-only conversation turns with the existing agent

## src/backend/services/ApprenticeStructured.ts

Status: IMPLEMENTED

- Batched structured tasks (extract, phrase, teach-back) over the text session

## src/backend/routes/apprentice.ts

Status: IMPLEMENTED

- POST /api/apprentice/structured

## tests/level-b/voice-session.spec.ts

Status: IMPLEMENTED

- Real voice session connect and teardown

## tests/level-b/live-flows.spec.ts

Status: IMPLEMENTED

- Fake-webcam browser runs: live Teach, upload Teach to Work Map, reload, live Learn, lifecycle cleanup

## tests/level-b/support.ts

Status: IMPLEMENTED

- Fake camera feed, track probe and DebugBus readers shared by Level B specs

## src/frontend/pose/PoseUsability.ts

Status: IMPLEMENTED

- Shared usable-pose and body-scale criteria for calibration, analysis and live tracking

## src/frontend/learn/ghostPose.ts

Status: IMPLEMENTED

- Teacher ghost landmarks from a lesson checkpoint, placed in the student's image space

## src/frontend/teach/RecordingDownload.tsx

Status: IMPLEMENTED

- Download link for the teaching video before the lesson is submitted

## src/frontend/media/useObjectUrl.ts

Status: IMPLEMENTED

- Object URL tied to an effect lifetime for replay and download

## src/backend/middleware/rateLimit.ts

Status: IMPLEMENTED

- Bounded in-memory per-client fixed-window limiter for the paid API routes

## src/scripts/fixtures/pace-demo-fixtures.mjs

Status: IMPLEMENTED

- Writes the browser demo student fixtures at a 6 s rep pace

## tests/unit/RateLimiter.test.ts

Status: IMPLEMENTED

- Limit, reset, per-client separation and cleanup

## tests/unit/CameraManager.test.ts

Status: IMPLEMENTED

- Late or superseded camera requests are stopped, not leaked

## tests/e2e/error-paths.spec.ts

Status: IMPLEMENTED

- Device denial, voice failure, invalid upload, Scribe failure and damaged lesson paths
