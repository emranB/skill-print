# 3D Movement Implementation and Validation

2026-10-04. Implementation is integrated, but empirical movement acceptance fails. Do not treat passing software regressions as evidence that arbitrary movement comparison is solved or release this as a validated matcher.

**Current follow-up:** new compilation constructs observed anchor regions with explicit source-quality evidence. Live progression remains causal local alignment, not DTW. Cycle self-replay still fails; temporal robustness, cross-demonstration and learner evaluation remain blocked. Section 22 reports the region trial. Section 21 preserves the preceding point-anchor local-alignment experiment, and sections 1-20 preserve the older RTMW3D + DTW stage. Historical conclusions in those sections are not claims about the current implementation.

## 1. Exact Model

MMPose RTMW3D-X, 133 COCO-WholeBody joints, 384 x 288 input. Official checkpoint: `rtmw3d-x_8xb64_cocktail14-384x288-b0a0eab7_20240626.pth`. Execution uses the Soykaf ONNX conversion referenced by RTMLib, SHA-256 `4a289c0e99d47eb595e99679d9d4a2d1def1b4241f9adcbafba44b9ff585ebcd`. No alternate pose/motion model or additional person detector is used.

## 2. Licensing and Provenance

Recorded before downloading weights in [RTMW3D_MODEL.md](RTMW3D_MODEL.md). MMPose, RTMLib and DTAIDistance source licenses are Apache-2.0. The community conversion card declares Apache-2.0; this does not independently establish rights to the original checkpoint or its training data, or equivalence to the official PyTorch weights.

Cocktail14 configuration includes COCO-WholeBody, Halpe, AIC, CrowdPose, MPII, JHMDB, PoseTrack, WFLW, 300W, COFW, LaPa, InterHand2.6M, UBody and H3WB/Human3.6M. Dataset permissions vary. Original checkpoint/data rights remain unresolved; commercial release is blocked. Weights are ignored, not redistributed. Installation requires explicit acknowledgement. Runtime verifies the checkpoint, acknowledgement and artifact hash against installation provenance.

## 3. Dependencies

Python 3.11 environment, separate from Node: NumPy 2.2.6, OpenCV contrib 4.12.0.88, ONNX Runtime DirectML 1.23.0 on Windows (CPU ONNX Runtime 1.23.2 elsewhere), DTAIDistance 2.3.13, requests 2.32.5, tqdm 4.67.1 and pytest 9.0.3. RTMLib is pinned to revision `03a1693e59e4f7cd84582c0fb30459b3bf18ad42` (built version 0.0.16), installed separately with `--no-deps`. PyPI RTMLib 0.0.13 does not contain the required 3D adapter. No npm dependency was added.

The local environment initially acquired upstream unpinned CPU/OpenCV dependencies; actual runtime modules were verified as DirectML 1.23.0 and OpenCV 4.12.0. The documented fresh-install order avoids that conflict.

## 4. Files in This Refactor

Added:

- `docs/RTMW3D_MODEL.md`, `docs/MOVEMENT_3D_VALIDATION.md`.
- `requirements-movement.txt`, `requirements-movement-adapter.txt`.
- `src/shared/movement/types.ts`.
- `src/movement/install_model.py`, `skeleton.py`, `alignment.py`, `worker.py`.
- Diagnostic-only `src/movement/extract_evidence.py`, `evaluate_evidence.py`, `benchmark_alignment.py`.
- `src/backend/services/MovementWorker.ts`, `src/backend/routes/movement.ts`.
- `src/frontend/pose/RTMW3DPoseDetector.ts`.
- `src/frontend/lesson/ReferenceMovementBuilder.ts`, `src/frontend/learn/DTWProgressTracker.ts`.
- `src/scripts/level-b/compile3dEvidence.ts`.
- `tests/movement3d/test_alignment.py`, `test_worker.py`, `tests/unit/Movement3D.test.ts`, `PoseRenderer.test.ts`.

Modified in this refactor, including files already dirty or untracked from the accepted baseline:

- `.gitignore`, `.dockerignore`, `.env.example`, `Dockerfile`, `README.md`, `src/backend/index.ts`.
- `src/frontend/pose/pose.types.ts`, `PoseNormalizer.ts`, `PoseDistance.ts`, `useLivePose.ts`, `LivePoseLoop.ts`.
- `src/frontend/analyze/CycleAnalyzer.ts`, `VideoPoseExtractor.ts`.
- `src/frontend/calibration/CalibrationFlow.tsx`.
- `src/frontend/components/LiveStage.tsx`: confidence-aware 3D ghost rendering and bounded canvas resolution; legacy defaults remain unchanged.
- `src/frontend/lesson/CanonicalMovementBuilder.ts`, `LessonCompiler.ts`, `LessonSchema.ts`, `RuntimeTargets.ts`.
- `src/frontend/learn/LearningRun.ts`, `LearnerVideo.ts`, `LearnFlow.tsx`, `CoachingSession.ts`, `PoseDeviation.ts`, `StudentCalibration.tsx`, `ghostPose.ts`.
- `src/frontend/review/LessonReview.tsx`, `src/scripts/level-b/runMovementValidation.ts`.
- `tests/movement/position-matrix.spec.ts`: cache fingerprint includes teacher compilation, extraction, normalization, model worker and dependency configuration instead of reusing stale compilation after those change.
- `tests/movement/upload-lifecycle.spec.ts`: adds a bounded-canvas assertion without weakening existing throughput, overlay, camera or EOF assertions.

The repository already contained extensive accepted 2D changes. This inventory does not claim all current Git changes as part of this refactor. Test-created lessons and ignored runtime/evidence artifacts are not source additions.

## 5. Medoid Removal

Deleted unfinished post-baseline `src/scripts/level-b/canonicalMedoidDiagnostics.ts` and `tests/unit/CanonicalMedoidDiagnostics.test.ts`. No medoid strategy was integrated into production. Accepted diagnostics, their tests and raw results remain intact.

## 6. Compatibility

New RTMW3D lessons bypass coordinate-median construction and the old checkpoint matcher. Legacy MediaPipe extraction, median-based canonical compilation, v1/v2 resolution and ProgressTracker remain explicitly for old 2D lessons and regression fixtures. They were not deleted because doing so would break the requested compatibility path. Mixed 2D/3D data is rejected, not relabeled or silently migrated. New 3D matching always uses angle weight zero.

## 7. Persisted Schema

Outer lesson schema remains version 1; movement canonical is version 3 with representation `rtmw3d-body-v1`, kind `cycle` or `sequence`, and independent `references`.

Each reference stores demonstration ID, teacher confirmation, alignment eligibility/rejection reason, the entire observed source trajectory, confidence-filtered source samples, and semantic anchors with hold duration. Ineligible references retain their raw source and explicit rejection reason; they are not matched. Every eligible sample is geometry from that one demonstration. Preview samples/checkpoints are from the first eligible source, not an aggregate or matching preference.

Source confidence, root, torso scale, anatomical basis, camera assumption, checkpoint and optional image size persist. Frontend validates finite geometry, representation, ordered paths and anchors; the bounded backend request schema independently validates requests. Explicit confirmation and eligibility metadata are required for new 3D references; missing metadata cannot authorize matching. Existing persistence stores the new nested representation without rewriting old lessons.

Existing uploads are unclassified until lesson submission. Draft Work Map previews can show unconfirmed complete sources, but the matcher cannot use them. Submission confirms unknown complete demonstrations, recompiles and persists; existing bad/ignored/fragment labels remain unchanged. Unusable references are retained with reasons rather than fabricated anchors.

## 8. Normalization and Coaching

RTMW3D produces image XY and root-relative depth. The adapter reconstructs camera coordinates using upstream default focal lengths 1145.0494/1143.7811, image-center principal point and root depth 5.14388. These are uncalibrated assumptions, not measured camera geometry.

Representation subtracts pelvis midpoint, divides by 3D torso length, and recovers an anatomical yaw basis from left/right hips and shoulders where confidence and agreement permit it. It retains lean and anatomical identity; it does not mirror/reassign sides. Twelve major-body joints and twelve normalized bone vectors are preserved. Matching uses unit bone directions, not absolute camera XYZ. Reliable common bone confidence must be at least 0.5, with at least six common bones and reliable orientation. Depth confidence is not exposed by the current RTMLib adapter and remains empty; confidence is predominantly image-plane confidence.

Ghost geometry is the current aligned source sample projected into the learner's basis/framing. It is never selected using elapsed learner time. The 3D ghost excludes joints below confidence 0.5, rather than drawing missing head/extremity slots from the image origin. The 3D canvas caps its maximum physical dimension at 960 pixels while preserving aspect ratio; legacy rendering defaults remain unchanged. Coaching uses reliable body-relative 3D joint differences, including forward/back deviations, without movement/view labels. The current implementation does not score detailed finger articulation despite the model's whole-body output.

## 9. DTW Configuration

DTAIDistance multidimensional DTW owns the dynamic programming. Forty-eight feature values encode twelve unit bone XYZ vectors plus confidence. Custom pair cost is the mean squared distance over mutually reliable bones; the library uses the Python implementation because this mask is not supported by its built-in C metric.

- Window: 15% of the longer path, minimum two samples.
- No open-end relaxation: psi 0, required first/last path endpoints.
- Warping penalty 0.02; no more than two consecutive horizontal or vertical path steps.
- Pair-distance bound: leniency x 1.25, default 0.3125. Existing leniency 0.25 / similarity requirement 0.75 is not weakened.
- Reported normalized distance is RMS of accepted path pair costs; similarity is `max(0, 1 - distance / 1.25)`.
- No accepted DTW path is reported as `null`, not a zero distance. Awaiting-start similarity is instantaneous geometry, not whole-cycle DTW similarity.

Learner observations are geometrically resampled; density does not authorize elapsed-time/FPS-based skipping. Teacher targets select actual source samples, never coordinate-average different sources. Acceptance also requires observed motion, at least three changing poses/frames, excursion at least half the teacher phase excursion and semantic holds. Unsupported frame jumps, tracking loss and gaps over 500 ms restart a candidate.

History arc length/excursion are cached incrementally without changing the underlying distances. A greater-than-3:1 path-length ratio is rejected before DTW because no endpoint-constrained path with at most two consecutive axis steps can satisfy that ratio. These optimizations avoid unnecessary history rescans/solves; they do not relax any acceptance condition.

## 10. Online Progression

A long-lived Python worker maintains causal state per run and independent candidate per confirmed eligible teacher source. Each candidate advances monotonically through start, outbound, apex hold, return and completion, or sequence start/ordered motion/completion. A reference switch cannot combine phases into a repetition. All references are evaluated without learner-fixture knowledge; display chooses maximum progress then similarity. Completed cycles reset candidates; completed sequences stop and cannot wrap.

Each live update uses only frames already observed, a geometrically bounded forward reach of 0.15 and a bounded 2048-observation buffer. Frontend queues asynchronous extraction/alignment and drains before EOF evaluation. Current displayed progress retains the run's maximum across candidate restarts, while the ghost uses the active candidate's aligned sample; this can become confusing and is a remaining issue, not proof of sustained alignment.

To avoid two serial HTTP requests per learner frame, a run can bind its detector stream to the worker's existing alignment state. Bound inference updates that same state once and returns its reply alongside the pose. The tracker consumes a batched reply only when both run ID and frame timestamp match; first/unbound frames use the explicit alignment endpoint, and stream replacement rebinds without resetting the trajectory. Completion/expiry clears bindings. Teacher extraction and unbound calibration remain inference-only. This is shared transport for upload and webcam, not a separate learner pipeline. A completed candidate owns its success event's reference/distance metadata even when another candidate has a higher instantaneous similarity.

## 11. Teacher Squat

Fixture confirmed: `data/lesson-squat.mp4`, 640 x 360, 24 FPS, 66.25 seconds. Native decoding samples 991 frames. Automatic existing generic segmentation finds only four complete cycles, including a merged 36-second region, rather than the six physical demonstrations. Browser seek-based extraction found seven complete regions plus one fragment. This instability is a major failure; neither count is corrected using fixture timestamps in production.

For diagnostic-only six-window annotations, all six source trajectories are retained; five are eligible, teacher 5 has an unreliable semantic anchor. Eligible sample counts for teacher 1/2/3/4/6: 34/47/42/16/61. The 3D apex is determined by observed geometry in each diagnostic trajectory, not teacher elapsed-time progress.

At difficulty 75, replaying each original teacher window against the confirmed set produces zero complete repetitions for all six:

- Teacher 1, front: 34/37 usable, 0% progress, maximum instantaneous similarity 1.0, closest teacher 1, DTW distance null.
- Teacher 2, front: 47/52 usable, 3.9254% progress, instantaneous similarity 1.0, closest teacher 2, minimum accepted normalized DTW distance 0.15010.
- Teacher 3, front: 42/42 usable, 0% progress, instantaneous similarity 1.0, closest teacher 3, distance null.
- Teacher 4, side: 16/126 usable, 0% progress, instantaneous similarity 1.0, closest teacher 4, distance null.
- Teacher 5, side: 37/64 usable, 0% progress, maximum instantaneous similarity 0.85178, closest teacher 6; its own reference is ineligible, distance null.
- Teacher 6, side: 61/97 usable, 0% progress, instantaneous similarity 1.0, closest teacher 6, distance null.

Exact source-frame identity is not whole-cycle self-consistency. This is not leave-one-demonstration-out testing, and cannot establish generalization. Teacher full-cycle replay acceptance fails even where reference-frame geometry is identical.

## 12. Learner Attempts

Fixture confirmed: `videos/test-squat-student_1.mp4`, 1920 x 1080, approximately 14.957 FPS, 36.436 seconds, 545 native frames. Final generic single-person ROI extraction yields 489 usable frames under the matcher, compared with much worse initial full-frame extraction. Both raw extractions are retained.

Each manually annotated physical attempt was replayed independently as well as in one continuous recording, at difficulty 20/50/75/80/100. With the diagnostic six-source/five-eligible reference set, every attempt at every level has 0% progress, no accepted DTW prefix, null normalized DTW distance and no REP_SUCCESS:

- Front 1: 75/75 usable; maximum instantaneous active/start similarity 0.82030, closest teacher 1.
- Front 2: 59/60 usable; similarity 0.60362, closest teacher 1.
- Side 1: 61/74 usable; similarity 0.62151, closest teacher 6.
- Side 2: 62/75 usable; similarity 0.68706, closest teacher 6.

These similarity maxima are not apex/bottom or full-cycle similarity. A single above-threshold pose in front 1 does not produce a repetition.

## 13. Front Versus Side

View labels exist only in diagnostic annotations. They never affect extraction, normalization, reference selection, DTW or thresholds. Front 1 has a better instantaneous match, but front 2 and both side attempts remain below threshold at their maximum active-state similarity. Neither view achieves a coherent cycle. Low side-teacher reliability and uncalibrated depth remain visible limitations; viewpoint invariance is not established by the normalization test.

## 14. Negative Motion

Independent difficulty-75 negative replays against annotated references:

- Initial setup/walking: 127/135 usable, 0% progress, zero reps; maximum instantaneous similarity 0.56127, closest teacher 3.
- Between-attempt turn/standing: 74/75 usable, 0% progress, zero reps; similarity 0.70315, closest teacher 6.
- Exit: 32/51 usable, 0% progress, zero reps; similarity 0.56819, closest teacher 3.

Continuous replays at all five difficulties also produce no false-positive repetitions. Automatic-reference coarse matching occasionally advances a small setup/exit prefix but never completes. Rejection is necessary, but because real positives also fail it is not evidence of improved motion discrimination.

## 15. Difficulty and Baseline Comparison

Difficulty controls geometric trajectory sampling, not acceptance tolerance. For levels 1/20/50/75/80/99/100, cycle target counts are 5/5/5/9/11/201/201; sequence counts are 3/3/3/5/6/101/101. Semantic anchors remain separate even where sparse source geometry maps more than one target to the same actual pose. No target-count-based skipping is used.

With annotated references, continuous learner results at 20/50/75/80/100 are all zero reps, zero progress. With automatically segmented native-decoded references, initial preserved results are zero reps at all levels and maximum progress 3.63946/3.63946/3.35207/3.63946/0%. Automatic and annotated sets must not be conflated.

Final browser streaming results are zero reps/zero progress at all five levels. At 20/50/75/80/100, delivered frames are 469/461/436/419/421 and usable frames 420/412/392/372/377. Every run ends with one EOF evaluation, no accepted DTW distance and `never_reached_apex`; the final instantaneous selected reference is `fb8f67a3-0977-4403-a345-19232f11322b` (the browser reference with 18 samples, not a physical-demo label). Earlier concurrent-load runs delivered 185/242/223/220/276 frames; those worse recordings are retained. Neither browser run is equivalent to an offline replay of all 545 native frames.

Accepted 2D POSITION baseline is preserved under `test-results/movement/generalization/accepted-baseline/`: zero reps at every level but maximum progress 20.37037%. Its canonical had 75/209 off-source samples and all six teacher apex checks failed. New coherent references eliminate cross-source coordinate synthesis by construction, but the empirical progression results do not improve on the accepted 2D baseline. Earlier full-frame RTMW3D artifacts are retained rather than overwritten with better ROI results.

The accepted-baseline directory retains eight original teacher/matrix artifacts totaling 33521065 bytes. The historical `generalization/production-integrity-final.json` describes the prior diagnostic stage; it is not an assertion that production remains unchanged after this explicitly authorized refactor.

## 16. Dance Sequence

Fixture confirmed: `data/lesson-dance.mp4`; 151 native-decoded extracted frames. Generic sequence compilation produces one reference with 137 reliable source samples, start/completion anchors, no apex or return, and version-3 persistence. Fresh browser seeking produces 153 frames and 138 reliable samples; these are separate extraction paths, not identical recordings of inferred geometry. Target counts are 3/3/3/5/6/101/101 at 1/20/50/75/80/99/100. Browser sequence compilation and rendering also pass. No learner dance recording exists; no dance learner success is claimed.

## 17. Webcam, Upload and EOF

Uploaded and webcam frames use the same RTMW3D adapter and causal DTW core; old lessons explicitly request the old detector/matcher. Run IDs remain stable through calibration and evaluation.

Final captured upload lifecycle: zero getUserMedia calls, calibration from a stable observed window at 4944.998 ms, rewind to frame zero, exactly one LEARN_EVALUATION_COMPLETE at EOF without a Finish click, stable run ID, no duplicate evaluation and no remaining media. It processes 261 frames (235 usable), naturally records zero reps, and has 32855 colored overlay pixels. Desktop/mobile screenshots were visually inspected; the bounded canvas and confidence-aware body ghost render without origin-to-body rays or overlapping controls. Five-level browser matrix also reports one EOF evaluation and zero camera calls per run.

Earlier lifecycle evidence remains: initial 286413 colored pixels; post-cache-fix 135 frames/119 usable/354697 pixels; isolated batched repeat 268 frames/233 usable/36831 pixels. Pixel totals before and after the resolution cap are not directly comparable. Final five-level calibration windows start at approximately 4.992/4.792/6.759/4.842/5.024 seconds; each run rewinds before matching. No first-frame calibration assumption is used.

The final Level B webcam regression passes: live Teach records 46 poses and a 2.023 MB, 9.972-second video; live Learn processes 509 frames, displays changing similarity from 30% to 94%, renders the ghost, produces two checkpoint events and 25 coaching cues, and naturally records zero successful reps. Earlier repeats recorded 246 learner frames (26-97% similarity) and 114 frames; their raw evidence remains. Device lifecycle shows two acquisitions/two releases and three pose starts/three stops; navigation returns to a clean calibration state. Save/reload preserves the lesson contract. The passing test checks pipeline operation, not movement accuracy.

Docker was updated for a separate CPU Python runtime and mounted acknowledged weights/provenance, but a Docker image build was not executed. A browser-only Sites deployment cannot execute this backend worker; this refactor was not published.

## 18. Performance and Hardware

Windows, Python 3.11, NVIDIA GeForce RTX 3050 Ti Laptop GPU (4 GB), driver 591.55, ONNX Runtime DirectML. Native isolated ROI inference: teacher mean 35.783 ms / p95 39.546 ms; learner 34.676 / 36.292 ms; dance 35.541 / 36.816 ms. Initial CPU frame was 280.794 ms. These figures exclude HTTP, JPEG encoding, rendering and DTW. Earlier browser streaming under concurrent tests delivered approximately 5-8 FPS. The final batched matrix delivers approximately 11.5-12.9 FPS over the 36.436-second recording, still not a demonstrated sustained 15 FPS.

The retained pre-batching browser trace shows inference RPC mean 224.43 ms / p95 373.16 ms despite approximately 77.45 ms internal inference, and alignment RPC mean 157.54 ms / p95 595.30 ms despite 0.73 ms internal alignment. Eliminating that second serial round trip and bounding render resolution fixes the unchanged lifecycle throughput assertion without altering movement acceptance.

Active synthetic 77-frame DTW benchmark, separate from accuracy evidence:

- One reference, difficulty 75: mean 1.59 ms, p95 2.88 ms.
- One reference, difficulty 100: mean 37.25 ms, p95 102.77 ms.
- Six references, difficulty 75: mean 7.27 ms, p95 12.85 ms.
- Six references, difficulty 100: mean 247.86 ms, p95 692.87 ms, maximum 867.64 ms.

Each synthetic benchmark naturally completes one ordered cycle, but six-reference difficulty 100 is not currently live 15 FPS capable. Before the history-cache fix, six-reference difficulty 100 averaged 302.93 ms / p95 814.06 ms; that raw benchmark is retained in `active-alignment-performance-before-cache-fix.json`. Initial fixture alignment means around 0.25-0.33 ms (later loaded repeat 0.41-0.67 ms; final annotated repeat 0.20-0.24 ms) mostly reflect failure to start, not active-DTW cost. Active benchmark timing was captured while browser regressions ran; it is not a controlled idle-machine benchmark.

## 19. Tests and Reproduction

Final `npm run verify`: 123 TypeScript unit tests in 31 files pass, both frontend/backend typechecks pass, lint has zero errors and three existing warnings, production build passes with existing chunk warnings. Python: 23 tests pass, including seven difficulty levels, slower/faster synthetic execution, unsatisfied anchor holds, sequence no-wrap, reverse/standing/isolated-frame rejection, confidence loss, coherent-source enforcement, explicit confirmation, cached-history equivalence, impossible slope pruning, success-event reference ownership, shared batched-worker equivalence/cleanup and translation/scale/yaw normalization. TypeScript regressions additionally verify exactly-once consumption of matching batched replies, stale-reply rejection and confidence-aware ghost drawing. No thresholds were adjusted for these tests.

Final E2E: 11/11 pass. Final Level B repeat: 8/8 pass, including real ElevenLabs voice teardown, Teach preview/submission, persistence, live Learn and webcam release. Final narration coverage is 16/16; an earlier repeat covered only 14/16 (T4/T5 missing). The existing >=13 acceptance assertion is unchanged, and the worse evidence is retained rather than presented as consistently complete coverage. Six demonstration-aligned teaching checks pass. Initial Level B had two failures and three dependent cases not run; retained artifacts show the initial three-anchor preview and unconfirmed-draft handoff errors. Those implementation defects were corrected without weakening assertions. An earlier E2E run was interrupted by development hot reload; the final run passes.

Final movement upload suite: 2/2 pass in `browser-movement-batched`, including a freshly compiled teacher/dance and all five learner difficulties. Earlier throughput failures observed 52, 41 and 39 frames versus the unchanged >60 requirement in 20 seconds; traces remain. History caching alone passed an isolated repeat but did not consistently fix browser throughput. Shared inference/alignment transport plus bounded rendering passes both the isolated lifecycle and complete suite without weakening timing assertions.

Final total: 123 TypeScript + 23 Python + 11 E2E + 8 Level B + 2 movement = **167 passing tests, zero final regression failures**. Prior accepted baseline: 114 unit + 11 E2E + 8 Level B + 2 movement = 135 passing tests. Following the final regression run, both annotated and automatic real-fixture DTW replays were repeated; accuracy results remain unchanged. Empirical teacher/learner full-cycle acceptance is a failure despite software regression passes.

Commands:

```powershell
npm run verify
.venv-movement/Scripts/python.exe -m pytest tests/movement3d -q
node_modules/.bin/playwright.CMD test --config=playwright.config.ts --workers=1
node_modules/.bin/playwright.CMD test --config=playwright.level-b.config.ts
node_modules/.bin/playwright.CMD test --config=playwright.movement.config.ts
node --import tsx src/scripts/level-b/compile3dEvidence.ts
.venv-movement/Scripts/python.exe src/movement/evaluate_evidence.py --references annotated
.venv-movement/Scripts/python.exe src/movement/evaluate_evidence.py --references automatic
.venv-movement/Scripts/python.exe src/movement/benchmark_alignment.py
```

Raw evidence: `test-results/movement/3d/compiled.json`; `roi/*-rtmw3d.json`; `annotated/difficulty-matrix.json`, `dtw-*-raw.json`, `teacher-consistency.json`, `teacher-*-raw.json`, `negative-replays.json`; initial automatic files at the 3d root and final repeats in `automatic/`; `active-alignment-performance.json` and its pre-fix copy. Previous annotated/automatic repeat timings are preserved in `annotated-before-final/` and `automatic-before-final/`. Final browser artifacts are under `browser-movement-batched/` (full teacher/matrix/lifecycle JSON and screenshots), `level-b-batched/` and `e2e-batched/`. Earlier artifacts remain under `browser-movement`, `browser-movement-final`, `browser-movement-recompiled`, `upload-after-cache-fix`, `upload-batched`, `level-b-final`, `level-b-post-fix` and `e2e-post-fix`. Re-running suites writes new global artifacts; immutable accepted-baseline copies remain separate.

## 20. Remaining Issues

- Critical: Real teacher self-replays and all four real learner attempts fail coherent full-cycle acceptance. Generic arbitrary teacher-to-learner comparison is not validated. Do not release on the strength of passing regression tests.
- High: Generic cycle segmentation misses/merges physical demonstrations and differs between native decoding and browser seeking; teacher anchors and tracking continuity remain unreliable.
- High: Six-reference active difficulty-100 Python DTW exceeds the live frame budget. Synthetic 15 FPS timestamps prove ordering compatibility, not real-time execution.
- High: Original checkpoint/training-data licensing remains unresolved; the community ONNX conversion is not independently checked against the official PyTorch checkpoint.
- Medium: Uncalibrated camera reconstruction and unavailable depth confidence limit trustworthy viewpoint normalization and occlusion-aware scoring. Single-person model-derived ROI cannot safely resolve multiple people.
- Medium: New matching currently scores twelve major-body joints/bones, not arbitrary fine finger/object movement. Persisted raw trajectories can be large; buffers and HTTP bodies are bounded.
- Medium: Displayed maximum progress can outlive a candidate restart even though the ghost resets to its active source sample. This does not cross semantic barriers but needs clearer active-attempt reporting.
- Medium: External semantic extraction is nondeterministic: an earlier pipeline repeat covers 14/16 annotated narration concepts (missing T4/T5), versus 16/16 in the final repeat, while both pass the unchanged regression assertion. This is not claimed to be fixed by 3D matching.
- Low: Existing lint and build chunk warnings remain. Docker build and a production deployment were not validated.

No geometric tolerance, fixture-specific threshold, view selector, known timestamp or filename branch was introduced to manufacture a repetition. Angle scoring remains disabled. Worse initial extraction, failed earlier regressions and failed empirical acceptance are retained as evidence.

## 21. Local Aligner Follow-Up: BEFORE / AFTER

### Status and Changes

The local aligner is wired into the production request path but has **not passed the acceptance gates**. This is not a release-ready replacement. No learner results were used to implement or choose its mechanics.

Added `src/movement/geometry.py`, `local_alignment.py`, `validate_local_alignment.py`, `benchmark_local_alignment.py`, `src/frontend/learn/LocalProgressTracker.ts` and `tests/movement3d/test_local_alignment.py`. Modified `worker.py`, `src/backend/routes/movement.ts` (transport comment), `LearningRun.ts`, `pose.types.ts`, `tests/movement3d/test_worker.py`, `tests/unit/Movement3D.test.ts`, `README.md` and this report. No teacher reference, extraction, normalization, tolerance, pose model, cycle/sequence schema or difficulty sampling implementation was changed.

`LearningRun` instantiates `LocalProgressTracker` for version-3 lessons; the worker instantiates `LocalAlignment`. The old `DTWProgressTracker.ts` is no longer imported by the production workflow. Its unused source and old `alignment.py` remain pending the requested gate-conditioned cleanup; the latter is used only to reproduce BEFORE results/offline diagnostics. Neither DTAIDistance nor the old online DTW module is imported by the new production worker path. No fallback silently substitutes DTW.

BEFORE source, report and tests were copied into `test-results/movement/local-aligner/before/`. Old `alignment.py` is byte-identical to its snapshot: SHA-256 `e5cb8f7601b2b0c2a18119b17918eeb1af77dac3efdd99fa00d18aec06e85f7d`. All prior failed DTW, 3D extraction and accepted 2D evidence remains intact.

### Causal Mechanics

Each eligible confirmed teacher reference owns its cursor, phase, previous supported observation, motion evidence and hold state. There is no accumulated learner trajectory and no dynamic programming. Storage per candidate is constant apart from its immutable teacher geometry.

For each observed pose, search the current position and a forward region bounded to 0.25 of the current geometric phase. This bound is independent of FPS, runtime target count and teacher elapsed time. Choose the closest geometrically supported actual source pose; equal-distance ties prefer the earliest position so standing or repeated identical poses cannot creep forward.

Multiple runtime targets can be crossed by one observation only when their geometry lies within the unchanged tolerance of the segment between consecutive supported observations. The segment check uses the same confidence mask, at least six common bones and RMS bone-vector distance. Higher difficulty samples more intermediate geometry for this check; it does not change tolerance. Ghost samples remain actual teacher source poses, not averaged skeletons.

Candidate position is monotonic until an explicit restart. A cursor cannot search globally, regress, combine references or enter the next phase before its anchor is held. Holds begin when the anchor's geometry is supported near the local endpoint, not only after landing on the exact final sample; crossing still waits for its full 150 ms. This corrected a real mechanical defect found in the first local run. At least three observed changes and half the teacher phase excursion remain required. Invalid tracking or a gap over 500 ms restarts; unsupported local matching lasting over 500 ms also restarts. Fewer than six common reliable bones between observations restarts instead of counting a non-finite distance as motion; non-finite origin distances cannot supply excursion evidence. Sequences complete once and cannot wrap.

Transport preserves batched inference/alignment, stream/run/timestamp validation, asynchronous draining and EOF idempotency. Diagnostics explicitly report `alignmentMethod: local_trajectory`, `localDistance` and `normalizedDtwDistance: null`; local distances are not mislabeled as DTW results. Current progress now follows active candidate state rather than retaining obsolete progress after a restart; the run's separate maximum remains available.

### Frozen Inputs and Production Replay

Primary AFTER evidence is `test-results/movement/local-aligner/gates-http-final/summary.json`: original RTMW3D poses replayed through Express `/api/movement`, its existing request validation, owned Python worker and actual local progression core. Earlier HTTP and NDJSON repeats under `gates-http/` and `gates-after-hold-fix/` produce the same acceptance/progress results; final comparison explicitly verifies unchanged input hashes and all self/resampling success/progress/anchor rows. Neither path re-extracts video, fabricates holds, appends rest frames, removes tracking loss or changes source timestamps.

Two unchanged teacher reference sets were checked:

- Annotated six physical demonstrations: five eligible references (teachers 1/2/3/4/6); teacher 5 remains explicitly ineligible and is not silently added to matching.
- Frozen browser compilation: seven eligible references, including its previously reported incorrect segmentation. These are not claimed to be seven physical demonstrations.

Input SHA-256 values match BEFORE and AFTER:

- `3d/compiled.json`: `22109416bcb5662b28f4dfc53f8dda539d46f886259d63aff43a5cabd8ab7ce7`.
- `3d/browser-movement-batched/teacher-cycle.json`: `9ad8a750d4b8cb9da2118b797de38d18bb36529ed2bf0439e4ecc18c129cc484`.

The controlled BEFORE repeat in `before-dtw-replay/` uses the unchanged old matcher with each source matched only against itself. Do not conflate this single-reference experiment with section 11's old reference-set replay, which sometimes followed another teacher source for a short prefix.

### Gate 1: Self Replay

All rows below list difficulties **20 / 50 / 75 / 80 / 100** in that order. Each AFTER success traverses start, outbound, held apex, return and held completion through the production path.

- Annotated teacher 1: BEFORE reps `0/0/0/0/0`; AFTER `0/0/0/0/0`, maximum progress `0/0/0/0/0%`.
- Annotated teacher 2: BEFORE reps `0/0/0/0/0`; AFTER `0/0/0/0/0`, maximum progress `0/0/0/0/0%`.
- Annotated teacher 3: BEFORE reps `0/0/0/0/0`; AFTER `0/0/0/0/0`, maximum progress `0/0/0/0/0%`.
- Annotated teacher 4: BEFORE reps `0/0/0/0/0`; AFTER `0/0/0/0/0`, maximum progress `0/0/0/0/0%`.
- Annotated teacher 6: BEFORE reps `0/0/0/0/0`; AFTER `0/0/0/0/0`, maximum progress `0/0/0/0/0%`.
- Browser C1 (`53315a8a-eb6a-403f-a924-6d42cfca365c`, 35 samples): BEFORE reps `0/0/0/0/0`; AFTER **`1/1/1/1/1`**, maximum progress **`100/100/100/100/100%`**.
- Browser C2 (`7e63c05b-a56b-4127-8393-adae6059672f`, 43 samples): BEFORE reps all zero, progress `5.6200/5.6200/5.6200/5.6200/0%`; AFTER reps all zero, progress `38.6841/38.6841/38.6841/38.6841/38.6841%`.
- Browser C3 (`afc2ad96-270f-4138-8236-8553ccbef100`, 43 samples): BEFORE and AFTER reps/progress all zero.
- Browser C4 (`4a78feb0-6148-4a84-aa6d-382a7fa0d6e7`, 13 samples): BEFORE and AFTER reps/progress all zero.
- Browser C5 (`0d111368-7856-4051-921b-c6e1d510e65f`, 111 samples): BEFORE reps/progress all zero; AFTER reps all zero, progress `47.5430/47.5430/47.5430/47.5430/0%`.
- Browser C6 (`fb8f67a3-0977-4403-a345-19232f11322b`, 18 samples): BEFORE and AFTER reps/progress all zero.
- Browser C7 (`26efc3de-7f78-49e4-a71d-2125e3616b45`, 221 samples): BEFORE and AFTER reps/progress all zero.

At difficulty 75, AFTER therefore passes **0/5 annotated and 1/7 browser references**, not every eligible reference. Gate 1 fails. An additional replay of only each reference's stored reliable samples, using their original timestamps, gives the same success counts; failure is not merely an artifact of replaying the raw unreliable frames. First local-run failures and the endpoint-hold fix are preserved separately in `gates/` and `gates-after-hold-fix/`.

### Locked-Constraint Conflict

The diagnostic `anchorEvidence` records every contiguous run within the unchanged 0.3125 geometric distance of each exact stored anchor. These are raw frame matches, independent of cursor search, difficulty and DTW. Matching runs use reliable geometry and cannot bridge tracking gaps.

- Annotated teacher 1: its only start-support interval is **8083.333-8208.333 ms, 125 ms**, below the required 150 ms. A point-wise identity match cannot satisfy that hold.
- Annotated teacher 2: its apex matches only the isolated **14333.333 ms** frame; longest supported apex interval is **0 ms**. Start matches near the end of the trajectory cannot authorize the earlier outbound phase.
- Annotated teacher 3: start support before its apex lasts at most **41.667 ms**; the longer start-shaped interval occurs on return, too late to traverse the recorded outbound path.
- Annotated teacher 4: start support is isolated; apex and completion support last at most **125 ms**. It has only 16 usable poses out of 126 and a **4750 ms** gap between reliable reference samples.
- Annotated teacher 6: start, apex and completion support are isolated frames; its longest gap between reliable samples is **833.333 ms**.
- Browser C1 has observed start/apex/completion support of **200/1267/200 ms** and naturally completes after the hold-counting fix. Browser C2/C4 have isolated apex support, C5 has only 67 ms apex support, C6 only 133 ms, and C7 isolated start support. C3's early start support lasts only 133 ms.

These conflicts exist before any temporal matcher runs. References were previously declared eligible based on reliable individual anchors and motion geometry, not proof that their own recorded streams can satisfy every hold or tracking-continuity rule. Under the locked reference/hold/loss rules, universal natural self-replay cannot honestly be certified by changing cursor mechanics alone. No anchor was relocated, hold shortened, confidence relaxed, missing interval filled or source marked ineligible to manufacture the gate.

### Gate 2: Resampling

Preserve elapsed recording time: 0.5x retains every second source frame plus endpoints; 1x is unchanged; 2x adds within-source interpolated poses (unit bone directions normalized, confidence conservatively minimum, no cross-source averaging); small drops omit every seventh frame while preserving timestamps/endpoints. No synthetic endpoint dwell is appended.

At difficulty 75, across the twelve eligible references:

- 0.5x: **0/12** produce one repetition.
- 1x: **1/12**, browser C1.
- 2x: **2/12**, browser C1 and C3. Annotated teacher 1 reaches 53.5202% but does not complete; that partial result is retained.
- Small drops: **0/12**.

Browser C1's retained start support shrinks from 200 ms to **133 ms** at 0.5x or after dropping its fourth frame, so its otherwise successful source cannot satisfy the retained observed 150 ms hold. This is not reported as resampling robustness. Gate 2 fails.

### Gate 3, Learner and Negatives

**Not run:** cross-demonstration matrix, the four physical learner attempts, continuous learner difficulties, and their setup/walking/turn/exit replays. Gates 1 and 2 must pass first. Their existing failed DTW evidence is preserved but is not presented as AFTER evidence. Synthetic standing, isolated-frame, reverse-sequence, missing-hold and cross-reference-collapse negatives pass against the new production core. No learner-driven tuning has occurred.

Dance references, sequence semantics and runtime sampling remain unchanged. Generic local sequence tests pass completion once/no-wrap and never invent an apex. No new real learner dance test is claimed.

### Performance

`local-aligner/performance.json` compares component timing against the retained `3d/active-alignment-performance.json`. Excludes RTMW3D inference, HTTP and rendering. New synthetic active benchmarks use the same 77-pose ordered cycle and ten repeats; each naturally produces exactly one REP_SUCCESS.

- One active candidate, difficulty 75: mean **0.343 ms**, p95 **0.573 ms**.
- One active candidate, difficulty 100: mean **0.441 ms**, p95 **0.770 ms**.
- Six active candidates, difficulty 75: mean **1.922 ms**, p95 **3.313 ms**.
- Six active candidates, difficulty 100: mean **2.310 ms**, p95 **3.943 ms**, maximum **6.239 ms**, versus DTW mean **247.856 ms**, p95 **692.871 ms**.
- All six retained actual teacher entries, difficulty 100: five are eligible/active, one remains rejected; mean **0.120 ms**, p95 **0.366 ms** over 418 original poses. This mostly measures failed-start states, not six simultaneously progressing real demonstrations.

The six-active stress case uses explicitly synthetic coherent references, not a fabricated sixth eligible real teacher. It demonstrates negligible local-core cost relative to the unchanged roughly 35 ms native DirectML inference; it does not establish movement accuracy or end-to-end webcam FPS. The earlier local benchmark (mean 2.212 ms / p95 3.800 ms at six-active difficulty 100) is retained in `performance-before-confidence-fix.json`. No new whole-history DP performance optimization was attempted.

### Tests, Evidence and Blocked Work

Current software regressions: **191 passed**, comprising 123 TypeScript tests, 57 Python tests (including retained offline DTW regressions, new local mechanics and batched worker equivalence), and 11 E2E tests. Typechecks/build pass; three existing lint warnings and existing chunk warnings remain. The new local tests cover seven difficulties, 0.5x/1x/2x synthetic motion speeds, small timestamp-preserving drops, multi-target traversal, monotonic local bounds, anchor barriers, tracking/common-bone-confidence restart, no DP/history, independent candidates and sequence no-wrap. EOF/batched-reply TypeScript tests explicitly verify the LocalProgressTracker integration. Software passes do not override the failed empirical gates.

The real learner upload matrix and live Level B learner run were deliberately not repeated after this replacement. Their section-19 results are BEFORE results, not current validation. Conditional removal of unused DTW files and production release/promotion remain deferred because the required gates have not passed.

Primary raw files: `local-aligner/gates-http-final/summary.json` and per-source raw traces, `gates-http/`, `gates-after-hold-fix/`, `gates/`, `before-dtw-replay/`, `performance.json`, `performance-before-confidence-fix.json`, `before/`, and `e2e/`. Summary files contain the full self-replay/density rows and anchor support intervals, with immutable input hashes. Cross-demonstration rows are intentionally absent, not fabricated failures.

Reproduction:

```powershell
.venv-movement/Scripts/python.exe -m pytest tests/movement3d -q
npm run verify
node_modules/.bin/playwright.CMD test --config=playwright.config.ts --workers=1
.venv-movement/Scripts/python.exe src/movement/validate_local_alignment.py --http-base http://127.0.0.1:8000 --output test-results/movement/local-aligner/gates-http-final
.venv-movement/Scripts/python.exe src/movement/validate_local_alignment.py --engine before-dtw --output test-results/movement/local-aligner/before-dtw-replay
.venv-movement/Scripts/python.exe src/movement/benchmark_local_alignment.py
```

Critical: universal self-replay/resampling acceptance remains blocked by the preserved reference/hold/continuity contract. High: actual positive/negative generalization remains unevaluated with the local matcher; original model/data rights remain unresolved. Medium: sparse observations can remove sufficient anchor-hold evidence, and existing RTMW3D depth/orientation/segmentation limitations remain. Low: existing warnings and unverified Docker deployment remain. The former high live-DTW computation cost is removed from the current online path, but this is not a successful movement-validation result.

Proceeding to universal gates requires permission to revisit generic teacher anchor construction/eligibility or another locked rule; no such correction is applied in this follow-up. The requested clarification is recorded in the chat. Do not proceed to learner tuning or reinterpret the held anchors as automatically satisfied.

## 22. Observed Anchor Region Construction Trial

The next instruction explicitly authorized generic reference/anchor construction and confidence-continuity corrections. This trial implements that contract but **does not pass the empirical acceptance gates**. It stops at Gate B, without evaluating or tuning against the learner recording. RTMW3D-X, normalization, twelve scored bones, confidence floor, six-common-bone requirement, 0.3125 distance limit / 0.75 similarity requirement, independent teacher candidates, geometric trajectory sampling, cycle/sequence semantics and angleWeight=0 remain unchanged.

### Implementation and Compatibility

New references carry `anchorConstruction: observed-regions-v1`, `quality`, and anchor `region` objects. A region stores source-index/time boundaries, the actual normalized teacher poses, geometric diameter and maximum observed speed. The anchor's single `pose` remains a coherent preview, not the region's acceptance definition. No coordinates are averaged, no phases are borrowed from another demonstration, and missing samples are never generated by production compilation.

`TeacherMotionEvidence` computes reliable-source masks, geometric steps/speeds, scalar excursion and a locally supported distance extremum. Boundary-connected endpoint neighborhoods prevent an interior pause from being relabeled as a start. Region radius is teacher-only: the smaller of 20% of source excursion and twice the median finite step, with a numerical epsilon for exact repeated poses. The three-sample scalar extremum filter suppresses isolated distance spikes; it does not smooth or synthesize pose geometry. These are provisional construction rules, not empirically validated semantic-state detection. No wall-clock percentages, known apex annotations, visual regime labels, filenames or expected demonstration count enter them.

Eligibility requires multiple reliable observations per region, source ordering/non-overlap, finite common geometry, at least three distinct motion observations per cycle phase, excursion of at least 0.25, observed return excursion, cycle-region closure inside the existing geometric tolerance, and resolved continuity. Sequence compilation needs no return or apex. A 100 ms synthetic teacher state can be observable and eligible even though the learner hold is still 150 ms; an isolated point is explicitly rejected. Quality failures and raw source poses remain inspectable even when compilation cannot produce a canonical.

Confidence policy: reliable intervals with missing samples or cadence greater than 2.5 times the source median are recorded explicitly. A confidence gap can be retained only up to 1000 ms and with finite endpoint displacement bounded by the larger of region radius and twice the source's 75th-percentile step. Unobserved prefixes/suffixes are reported and rejected beyond 500 ms. Nothing is interpolated. This policy cannot distinguish all physical departures from inference errors; ambiguous geometry is rejected, not asserted to be a valid movement.

For new region references the local cursor can survive short, geometrically supported confidence loss without advancing or inferring motion across it. Invalid observations clear the hold. A supported-observation interval greater than 250 ms clears the hold; longer than 1000 ms or geometrically inconsistent reacquisition restarts the candidate. Anchor holds match actual region poses at the unchanged tolerance. Remaining region-contained endpoint samples are treated as the semantic state, rather than requiring its preview point in addition to the region. Non-region targets, bounded forward search, ordered motion and all unsatisfied anchor barriers remain enforced.

Persistence and HTTP validation retain the version-3 reference-set envelope, adding the explicit construction discriminator. Stored version-3 references without it retain point-anchor matching and the old loss policy; legacy 2D lessons remain unchanged. Newly persisted regions require actual source geometry and a 150 ms hold. HTTP verifies region sample membership in the coherent reference. The backend compiles as a separate TypeScript root, so its wire schema is independent of client imports. Existing saved lessons are not rewritten.

### Evidence and Recompilation

All three video fixtures were confirmed present. Recompilation used original native extracted teacher poses and, separately, the browser's full original pose recording, not repaired saved references. Six accepted physical boundary windows delimit evaluation clips only; no apex annotation is supplied. Teacher confirmation is simulated by the diagnostic harness and marked as evaluation metadata. The native and browser teacher streams are different extractions; neither is silently substituted for the other.

Primary artifacts under `test-results/movement/anchor-regions/`:

- `compiled-frozen.json`: exact frozen construction, raw geometry, every rejection, automatic segmentation and runtime counts. SHA-256 `70a1a7786a1f2c3f5e01d4b9010c7a9bd09476a0be14e459d013674520bfad93`.
- `gates-production-final/summary.json` and per-execution `*-raw.json`: Express route -> production worker -> production local aligner. Contains all 24 inspected physical/automatic/sequence references, source-quality reports, independent region-support intervals, and ten self-replay rows. Earlier `gates-http/` traces are also preserved.
- `gates-final/`, `gates-http-final/`, `gates-http-frozen/`: prior worker/HTTP runs retained, not overwritten by the final run.
- `before/`: original point-anchor builder, local matcher, replay harness, segmentation code and validation report snapshots. Earlier `local-aligner/` and RTMW3D/DTW evidence remain intact.
- `compiled-initial.json`, `compiled-global-stability.json`: intermediate construction attempts preserved. A defective global-first-stable-run rule could select the interior turnaround as the start; that structural error was removed before the final freeze. These are not accepted alternatives or learner-driven tuning.

Native teacher cache hash: `b3cbba60549259411537f5bc5f19e506f7134e6f0a58b4f42c127abbc312b1f1`. Browser evidence hash remains `9ad8a750d4b8cb9da2118b797de38d18bb36529ed2bf0439e4ecc18c129cc484`. Native dance cache hash: `7bde599578de5c3d02a34bfa832ca7fda3d1eb00b1563bfde008cf37f1eabc4c`.

### Gate A: All Six Physical Demonstrations

Native extraction: **0/6 eligible** under the provisional construction rules. This is not a vacuous self-replay pass, and it does not establish that the physical teacher demonstrations are invalid. Each region below reports observed samples, absolute source time span in milliseconds; singleton regions are rejected evidence, not usable anchors. Full source indices, velocity/diameter and gap details are in the primary JSON.

- T1: 37 source / 34 reliable; start 1 at 8083.333; turnaround 11 at 8875-9750; completion 3 at 10333.333-10500. Largest gap 291.667 ms; excursion 0.625786. Rejected: isolated start and no region closure within tolerance.
- T2: 52 / 47; start 1 at 13000; turnaround 3 at 14166.667-14291.667; completion 5 at 16166.667-16416.667. Gap 291.667 ms; excursion 0.693974. Rejected: isolated start and ambiguous confidence continuity (observed endpoint displacement 0.758180 across one gap).
- T3: 42 / 42; start 2 at 18291.667-18333.333; turnaround 9 at 19208.333-19750; completion 2 at 20958.333-21000. No confidence gap; excursion 0.567909. Rejected: completion/start regions do not close within tolerance.
- T4: 126 / 16; start 1 at 30750; turnaround 1 at 37333.333; completion 3 at 38958.333-39083.333. Gap 4750 ms; excursion 1.102587. Rejected: unresolved gaps, isolated start/turnaround, inadequate outbound evidence and closure.
- T5: 64 / 37; start 1 at 42333.333; turnaround 1 at 44083.333; completion 1 at 46500. Gap 1041.667 ms; excursion 0.701803. Rejected: unresolved continuity, singleton regions and closure.
- T6: 97 / 61; start 1 at 56875; turnaround 1 at 60083.333; completion 1 at 63291.667. Gap 833.333 ms; excursion 1.139594. The geometrically supported short gap is retained, but all three singleton regions fail observability.

Browser extraction: **1/6 eligible**, T2 only. Separately inspected, not treated as six new physical movements:

- T1: 38 / 37; start 2 at 8067-8133; turnaround 1 at 9800; completion 3 at 10400-10533. Gap 134 ms; excursion 0.682243. Rejected: isolated turnaround and closure.
- T2: 53 / 45; start 2 at 13000-13067; turnaround 2 at 13933-14000; completion 5 at 16200-16467. Gap 533 ms; excursion 0.759070. Structurally eligible, but fails Gate B below.
- T3: 43 / 43; start 1 at 18267; turnaround 6 at 19133-19467; completion 3 at 20933-21067. No confidence gap; excursion 0.685151. Rejected: isolated start and closure.
- T4: 127 / 15; start 1 at 30733; turnaround 3 at 38933-39067; completion 2 at 39067-39133. Gap 3267 ms; excursion 0.890278. Rejected: unresolved continuity, isolated start, overlapping semantic regions, inadequate ordered/return evidence and closure.
- T5: 65 / 35; start 1 at 42333; turnaround 1 at 43800; completion 1 at 46333. Gap 1134 ms; excursion 0.618450. Rejected: unresolved continuity, singleton regions and closure.
- T6: 98 / 58; start 1 at 56933; turnaround 6 at 60667-61333; completion 4 at 63133-63333. Gap 866 ms; excursion 1.138273. Rejected: ambiguous geometry across gaps, isolated start and closure.

Neither automatic native nor automatic browser cycle compilation yields an eligible reference. All predicted candidates retain quality/rejection records. The structural Gate A flag means only that the two declared eligible references (browser T2 and the dance sequence) contain the required source-backed fields and evidence. It is not a claim of successful native cycle compilation or validated anchor semantics.

Dance: one eligible sequence, 137 / 137 reliable source samples, excursion 0.862921, no confidence gap. Start region: 37 samples, 959.292-3336.667 ms; completion: 4 samples, 9801.458-10010 ms. No return/apex is created; no learner dance recording is fabricated.

### Gate B: Self Replay and Diagnosis

Every eligible reference was replayed against itself through the exact production HTTP path, using its untouched source trajectory. Results at difficulties **20 / 50 / 75 / 80 / 100**:

- Browser physical T2: repetitions **0 / 0 / 0 / 0 / 0**. Maximum progress **50 / 50 / 50 / 50 / 0.559448%**. Only start is satisfied; neither turnaround nor completion is satisfied. Identity geometry at individual frames still does not establish the required controlled semantic transition.
- Dance sequence: exactly **one SEQUENCE_COMPLETE at every level**, 100% progress, start then completion. Zero REP_SUCCESS is correct sequence behavior.

Thus **0/1 eligible cycle references pass self-replay at 75**. Including the independent sequence control gives 1/2 successes, not the required 100%. Gate B fails; no real-video Gate C/D/E runs are authorized.

T2 diagnostics separate region construction from cursor mechanics. Its start region has 200 ms of early supported observations; completion has 1067 ms on return. Turnaround support is fragmented: 13600-13667 (67 ms), 13800 alone, 13933-14000 (67 ms), and 15000 alone. The longest interval anywhere is only **67 ms**, despite the region containing two actual observations. At 14067 ms the local distance is **0.339399888**, similarity **0.728480090**, below the unchanged 0.75 requirement. At 14133 the pose is unreliable; at 14200 reacquisition has inconsistent geometry and restarts the candidate. No missing interval is credited as a hold. At difficulty 100, dense ordered targets cause earlier stalls; these failures are preserved rather than reducing density or geometric requirements.

The construction/hold contract therefore remains inconsistent for this declared eligible cycle. Multi-sample observability alone does not certify that this inferred state captures the real turnaround, nor that the unchanged execution can demonstrate a 150 ms controlled hold inside it. Rejecting T2 solely because its teacher did not hold for 150 ms would reintroduce the forbidden coupling; widening its region until this recording passes would be unvalidated acceptance tuning. Neither was done. The next diagnostic target is semantic-region inference/observed geometric discontinuity, not learner thresholds or a return to DTW.

### Gates C-E and Negative Controls

Real-video temporal density/drop/faster/slower tests, leave-one-demonstration-out matrix, four learner attempts, continuous learner difficulty matrix and setup/walking/turn/exit negatives are **not run after Gate B fails**. Empty matrix/temporal fields in the summary mean blocked, not zero successful empirical executions. Existing historical results remain BEFORE evidence only. No front/side learner claim or viewpoint-invariance claim is made.

Generic software tests do exercise region holds at 0.5x/1x/2x density and faster/slower time scales at difficulty 100, missing-confidence recovery, no inferred progress, anchor barriers and sequence no-wrap. Eight continuously observed density/speed combinations complete naturally. The combined lowest-density/slowest cadence has a 266.667 ms observation interval, exceeding the explicit 250 ms hold-continuity bound, and correctly does not complete; it is a negative observation-gap test, not claimed as temporal robustness. The original failing positive assertion is not repaired by weakening that bound. These synthetic tests cannot substitute for real-video Gate C.

Synthetic standing, isolated frames, reverse sequence, unsupported anchor, common-confidence loss and cross-reference-collapse negatives still pass. Actual negative discrimination remains unevaluated for the region trial. No explicit angle scoring or angle gates were enabled or tuned.

### Automatic Segmentation, Separately

Automatic segmentation now uses RTMW3D reliability rather than unrelated image-landmark visibility when body geometry is present. Each proposed cycle is instrumented with the same original-source motion/region/continuity evidence used by compilation. The legacy rest-clustering/segmentation algorithm itself has not been claimed fixed.

Native: 686 / 991 frames usable; four complete proposals, no fragments: 6500-8166.667, 10666.667-18166.667, 21666.667-57833.333, 57875-63833.333 ms. The third proposal merges several physical demonstrations and the turn/standing intervals over 36.167 seconds. Best temporal IoU against physical T1-T6 is 0.024713 / 0.462267 / 0 / 0.232258 / 0.117982 / 0.783482. Only T6 exceeds an illustrative diagnostic IoU of 0.5; that criterion never affects production.

Browser: 698 / 994 frames usable; seven complete proposals plus initial fragment 0-6067. Complete boundaries: 8067-10400, 12933-16267, 18267-21067, 23867-24667, 24800-39600, 39667-41267, 41733-63867 ms. Best physical IoU is 0.946067 / 0.924448 / 1 / 0.567568 / 0.192780 / 0.292130. Two proposals at 23867-24667 and 39667-41267 overlap no annotated demonstration; the final proposal merges physical T5/T6 and their interlude. Four physical windows exceed diagnostic IoU 0.5, but only the first three have closely aligned boundaries.

Cause indicated by instrumentation: global/rest-regime clustering and coarse long-absence handling remain unstable under inferred bone/orientation changes and low-confidence gaps. Native merging and browser false splits/merges are recorded independently of matcher acceptance. No hard-coded count=6, view-specific rest or timestamp exception was added. **Segmentation remains unacceptable and high priority.**

### Runtime Counts, Tests and Cleanup

Difficulty **1 / 20 / 50 / 75 / 80 / 99 / 100**: cycle reference counts **5 / 5 / 5 / 9 / 11 / 201 / 201**, measured on the eligible browser cycle; native cycle compilation has no canonical. Sequence counts **3 / 3 / 3 / 5 / 6 / 101 / 101**. Density does not change tolerance, hold or forward-reach limits.

Modified source files: `ReferenceMovementBuilder.ts`, `LessonSchema.ts`, `pose.types.ts`, `CycleAnalyzer.ts`, `analyze.types.ts`, backend `routes/movement.ts`, `movement/local_alignment.py`, and `movement/validate_local_alignment.py` (sequence completion count only). Added: `TeacherMotionEvidence.ts`, shared `referenceSchema.ts`, `compileAnchorRegionEvidence.ts`, `validate_anchor_regions.py`, `TeacherMotionEvidence.test.ts`, and `test_anchor_regions.py`. `Movement3D.test.ts` now supplies genuinely observed multi-sample synthetic anchors; its old singleton-anchor premise is covered explicitly as a rejection test. README and this report are updated. RTMW3D extraction/normalization and old DTW code are unchanged.

Final software regressions: **214 passed, zero final failures**. TypeScript: **130 tests pass**, including seven new construction/schema tests and upload EOF/batched-reply compatibility tests. Python: **73 tests pass**, including sixteen new region/continuity/missing-geometry tests. Typechecks, lint and build pass; the same three existing lint warnings and chunk warnings remain. Final frozen-source E2E: **11/11 pass**, including legacy fixture lesson persistence/repetition and camera/error/lifecycle paths. The first browser run passed ten and failed the fixture-learn case after an agent source edit triggered a reload back to Home; its error context is preserved under `e2e/` and the successful rerun under `e2e-final/`. No expectation or production behavior was changed to repair that interruption. Real-upload Level B/movement learner suites are not rerun because they would cross the failed teacher gate; previous runs remain historical evidence, not current certification. The failed empirical cycle gate is separate from these passing software tests.

Conditional DTW cleanup is **deferred**, because A-C do not pass. `DTWProgressTracker.ts` remains unused; `alignment.py` remains offline/before tooling. Production still imports only LocalAlignment for new 3D online progress. No live DTW is restored, and no site deployment or git push is performed.

Reproduction (diagnostic outputs are local and not release artifacts):

```powershell
node_modules/.bin/tsx.CMD src/scripts/level-b/compileAnchorRegionEvidence.ts
.venv-movement/Scripts/python.exe src/movement/validate_anchor_regions.py --http-base http://127.0.0.1:8000 --output test-results/movement/anchor-regions/gates-new-run
.venv-movement/Scripts/python.exe -m pytest tests/movement3d -q
npm run verify
node_modules/.bin/playwright.CMD test --config=playwright.config.ts --workers=1
```

### Eight Required Conclusions

1. **Reference construction validity:** implemented and structurally inspectable, but empirically inadequate. Native cycle compilation rejects all six; browser compilation accepts one that fails its control semantics. This is not reference-construction success.
2. **Self-replay validity:** failed for the eligible cycle at every tested difficulty. The sequence control succeeds once at all five levels. Universal Gate B is not met.
3. **Temporal robustness:** real-video Gate C blocked; synthetic supported-observation tests pass, with sparse unobserved holds explicitly rejected. No real temporal-robustness claim.
4. **Cross-demonstration generalization:** Gate D blocked, no AFTER matrix or independent recognition claim.
5. **Learner generalization:** Gate E blocked; four attempts and continuous recording remain untouched and unevaluated in this trial.
6. **Negative discrimination:** generic regressions pass, but real setup/walking/turn/exit discrimination is not established after the region change.
7. **Segmentation quality:** still unacceptable: four native / seven browser proposals from six physical demonstrations, with documented merges and false positives. Instrumented, not solved.
8. **Arbitrary movement matcher empirically validated:** **No.** Passing software and one dance self-replay do not override failed cycle-reference/self-replay gates.

Critical: reference/control semantics still violate universal self-replay. High: native fixture cannot compile a cycle, automatic segmentation remains wrong, actual positive/negative generalization is blocked, and original model/data rights remain unresolved. Medium: provisional region inference and confidence-gap criteria are not semantically validated; sparse sampling must not be mistaken for held control. Low: existing lint/build warnings and unverified Docker/hosted backend deployment remain.

## 23. Final Generic Movement Investigation

**Conclusion: NOT READY.** The final task revoked the old hold, tolerance, representation and model locks. Investigation continued beyond failed RTMW3D self-replay into alternative models, segmentation, teacher-only calibration, causal matching and real learner diagnostics. A safe complete-geometry replacement was not established. Only the independently justified mandatory-hold correction is promoted. Positive diagnostic repetition counts are not release certification.

### Production Architecture and Compatibility

There remains one active v3 path: RTMW3D-X local inference -> source-backed independent teacher references -> Python causal local alignment -> shared LearningRun/LivePoseLoop for webcam and upload. No accumulated-history DTW determines live progression. No replacement MediaPipe descriptor or experimental cursor is imported by the worker.

Generated v3 anchors now have `holdMs: 0`. Optional explicit holds use `holdSource: "teacher_requested"`; their continuous-observation checks remain tested. Old generated bare 150 ms fields are ignored for v3 holds, without rewriting saved lessons. No arbitrary substitute dwell is introduced. The frontend and HTTP schemas accept that marker and no longer require exactly 150 ms. Legacy v1/v2 matching is unchanged. Saved v3 point-reference compatibility remains. Geometry tolerance in the retained production path is still 0.3125; no learner-derived tuning or angle score was enabled.

This does **not** finish landmark inference: the retained production builder still requires multi-sample anchor regions, and the retained matcher still uses geometric anchor support. Removing those architectural restrictions without a validated replacement would not establish generic recognition. They remain explicit unfinished requirements, not hidden successes.

Production BEFORE/AFTER on the byte-identical frozen reference set:

- Browser T2 is the only eligible annotated cycle. Before: zero repetitions, maximum progress 50% at 20/50/75/80 and 0.559448% at 100. After removal of generated holds: zero repetitions and **53.302651% at every tested difficulty**, start and turnaround supported, return/completion still fails. Identity replay remains invalid.
- Native annotated cycle compilation still has zero eligible references; browser annotated compilation has one. Automatic cycle compilation still has none. These old annotation windows are not reliable physical cycle ground truth, as documented below.
- Production dance: 137 reliable samples; one SEQUENCE_COMPLETE, 100% progress at 20/50/75/80/100. No apex/return is added and no learner dance test exists.
- Runtime target counts at 1/20/50/75/80/99/100 remain cycle **5/5/5/9/11/201/201** and sequence **3/3/3/5/6/101/101**. Sampling changes neither tolerance nor forward reach.

Primary raw production evidence: `test-results/movement/final-generic/production-no-hold/summary.json` and ten unmodified per-replay files. The historical validator's `stoppedAt`/`learnerEvaluationAuthorized` fields describe its old gate contract, not the final task's authority; the subsequent experiments below were actually run.

### Representation and Model Evidence

All three requested video fixtures are present and unchanged. SHA-256: squat teacher `8168b6090620dc5daa94ff28518937503c5f0065633a57b2eff092d5e4594d1b`; dance teacher `8865b633f0e1cbb580bcf4dcedc3fe8db1ff1f01daa5d804303f3e16711121c3`; learner `870303a0177588f8a5927c123ce1a9cb2e8f4208586724692c8979ffb59aa739`.

Teacher-only geometry oracle, **not online acceptance**, compares original native RTMW3D, original browser RTMW3D and original MediaPipe recordings. All twelve scored major-body bones remain represented. Nearby/distant/cross-source distributions and complete oracle matrices are in `teacher-representations.json`.

- Native RTMW3D bone XYZ: adjacent-distance p95 0.89146; median across cross-phase-pair medians 0.94941. Usable samples in the six old windows: 34/47/42/16/37/61. The fourth, side-oriented window is especially unreliable.
- RTMW3D XY: adjacent p95 approximately 0.188-0.196, cross-source median approximately 0.814-0.822; the front/side mismatch remains. Hybrid equals XY here because no usable depth-confidence values are supplied: this is **not** independent evidence that reliable depth never helps.
- Unrotated/body-relative RTMW3D: cross-source median approximately 0.744; substantial side mismatch remains.
- MediaPipe image XY: adjacent p95 0.13024, cross median 0.6929. World XYZ without body-yaw alignment: adjacent p95 0.13093, cross median 0.9785.
- MediaPipe gravity-inclination plus parent-bone flexion: adjacent p95 **0.11076**, cross median **0.35152**. Better consistency motivated the next causal experiments, not automatic model promotion.

The oracle uses old cropped/grouped windows and geometric phase alignment, so it does not isolate model error from segmentation/teaching variation perfectly. These results justify exploring alternatives, but do not prove universal mathematical impossibility for RTMW3D or monocular pose estimation.

Controlled additional teacher extraction: MediaPipe Heavy IMAGE/GPU and VIDEO/GPU, plus Full VIDEO/CPU, each processed 994 monotonic real timestamps spanning 0-66.2 s. Heavy did not resolve complete-geometry generalization. Earlier probes incorrectly replayed timestamp zero because the dev media URL was not seekable. Those raw `*-VIDEO.json`/`*-IMAGE.json` files and their test traces are retained but **invalid for inference/generalization comparisons**. Valid `*-seekable.json` probes use a Blob URL and assert temporal coverage, not just frame count.

### Segmentation and Coherent References

The presumed six annotated "physical demonstrations" are not six clean complete cycles. Several windows begin after descent; the fifth includes multiple shallow bends and omits additional bends; the sixth combines earlier shallow and later deep movement. The unlabelled whole-video contact sheets and 41-64 s contact sheet preserve visual evidence. No production logic receives those annotations or view labels.

Offline segmentation uses all-body geometric motion SNR, a dominant trajectory coordinate, time-supported rest mode, excursion hysteresis and confidence continuity. A scalar median stabilizes the segmentation signal only; no pose is coordinate-averaged to construct a reference. Fixed-duration noise estimation corrects an earlier cadence-dependent estimator.

On the original MediaPipe teacher extraction, full density, half density and small drops each produce **11 proposals**. Full-density windows, milliseconds: 7933-10333; 12800-15933; 18067-20800; 28400-38933; 41933-44133; 45000-46467; 47267-48467; 50333-51533; 52733-54200; 56867-59133; 59267-62533. This count is not hard-coded or called eleven certified physical repetitions. One long side-view hold/gesture interval remains an episode. Best overlap with old first four windows: 0.8715/0.7998/0.8443/0.764. Cadence stability here is **resampling one extraction**, not independent native-versus-browser MediaPipe validation. Production RTMW3D's old 4/7 discrepancy is not claimed fixed.

Each diagnostic reference retains one actual teacher source. Local RDP simplification preserves actual source poses; no median bodies or phase mixing. Temporal 2x resampling interpolates **execution observations only**, not canonical geometry. Teacher-only reference eligibility requires uncertainty balls around rest/excursion to be separated. The frozen reduced candidate retains proposals **1/2/3/4/11**; smaller bends are not quietly accepted as equivalent deep demonstrations. Quality histories and rejection evidence are retained.

### Teacher-Only Causal Experiments

The offline causal cursor uses bounded phase-local polyline projection, monotonic within-attempt progress, segment-supported skipped targets, explicit tracking restart, and no history DP. Source-relative feature offset is frozen from the observed starting pose. Phase landmarks have no universal dwell; terminal geometry must be a locally supported optimum, not just lie somewhere inside a broad tolerance ball. One independent cursor per source is maintained.

Calibrations use teacher sources only: nearby variation, nearest other-source geometric-phase residuals, positive motion SNR weights for all twelve bones, and rest/excursion discriminability. The reduced frozen candidate uses pooled teacher p95 tolerance **0.3622671917**. Later alternatives test per-source-balanced p95, complete body XYZ plus flexion, complete inter-bone Gram plus chirality, teacher-predictable channel weights, and full-rank 48-dimensional OAS covariance whitening. No learner results set those calibrations. The successful reduced calibration is frozen at SHA-256 `f49adbfa657be55e297d65dc7c37be5359b19ad8cf3a8c2d428ca1a3b3b078a7`.

Reduced candidate: **5/5 self-replay** at 20/50/75/80/100; **5/5** at 0.5x/1x/2x density and small drops at difficulty 75. Four of five eligible sources recognize another source under strict source-held-out calibration. Across all eleven proposals, **4/11** have a held-out completion; the long side episode fails and shallow variations remain unsupported. Continuous teacher replay yields four, not five, repetitions. Teacher background chunks produce zero repetitions. Earlier variants with nine-of-eleven half-density success and an exit false positive are preserved, not overwritten.

Full held-out reduced-candidate completion matrix, executions/columns in proposal order 1-11. `-` excludes identity; `X` is a reference rejected by that row's training-only eligibility fit, not a geometric comparison. `0` means compared without completion; `1` means completion. Each row refits with its execution excluded, including uncertainty and eligibility. Reporting labels never select references.

```text
        1 2 3 4 5 6 7 8 9 10 11
 1      - 1 1 0 X X X X X X  0
 2      0 - 1 0 X X X X X X  1
 3      1 1 - 0 X X X X X X  0
 4      0 0 0 - X X X X X 0  0
 5      0 0 0 0 - X X X X X  0
 6      0 0 0 0 X - X X X X  0
 7      0 0 0 0 X X - X X X  0
 8      0 0 0 0 X X X - X X  0
 9      0 0 0 0 X X X X - X  0
10      0 0 0 0 X X X X X -  0
11      0 1 1 0 X X X X X X  -
```

Complete-geometry alternatives do not justify promotion:

- Balanced reduced candidate: eleven self successes, four held-out successes, eight half-density successes.
- Body XYZ plus parent flexion: nine eligible/self successes, three held-out executions, seven half-density successes.
- Gram plus chirality: seven eligible/self successes, two held-out executions, six half-density successes.
- Teacher-predictable full channels: eleven self successes, four held-out executions, eight half-density successes.
- Full-rank OAS: **11/11 identity successes, 5/11 held-out executions, 9/11 half-density successes**. Zero background completions. Whitening does not remove any scored joint or dimension. Identity success alone is insufficient.

The most promising earlier Heavy VIDEO/full-body XYZ trial is also retained, rather than omitted because it looked better: seven proposals, seven identity successes, five held-out executions, zero teacher-background completions, pooled teacher tolerance **0.5179224**. Replaying that exact frozen calibration through the current diagnostic cursor gives **7/7 identity at all five difficulties**, **6/7 half density**, **7/7 normal/double density/drops** at 75, and **0/7 static-start completions** at 100. Thus the original candidate itself does not pass the temporal robustness condition; the later geometry-quality rule is not the sole reason it is rejected. Applying the same final teacher-only balanced calibration/eligibility machinery retains six sources at tolerance **0.1558792**: six self successes at every difficulty, **2/7 held-out executions**, **5/6 half density**, six normal/double/drop successes, one continuous-teacher repetition and zero teacher-background repetitions. No Heavy learner recording is evaluated or threshold adjusted from learner outcomes after those failures. Raw evidence: `causal-teacher-heavy-video-body.json`, `heavy-body-original-frozen-robustness.json`, `fitted-heavy-video-body-balanced.json`. These limited failures do not prove no improved generic trajectory mechanics could ever rescue the model.

The failing Heavy half-density source is the first proposal: maximum progress **91.2586%**, return phase, mean local similarity **0.97261**, p5 **0.94544**, no completion. Balanced calibration also stalls that source at **91.7727%**. This exposes an unresolved terminal-landmark/observation-support inconsistency in the experimental cursor, not low similarity or proof of intrinsic model impossibility. It is retained as a temporal-mechanics limitation alongside the separate held-out geometry failures; neither is hidden behind identity successes.

Full OAS held-out matrix (same proposal order, no excluded non-diagonal references):

```text
        1 2 3 4 5 6 7 8 9 10 11
 1      - 0 0 0 0 0 0 0 0 0  0
 2      0 - 1 0 0 0 0 1 0 0  0
 3      1 1 - 0 0 0 0 0 0 0  0
 4      0 0 0 - 0 0 0 0 0 0  0
 5      0 0 0 0 - 0 0 0 0 0  0
 6      0 0 0 0 1 - 0 0 1 0  0
 7      0 0 0 0 0 0 - 0 0 0  0
 8      0 0 0 0 0 0 0 - 0 0  0
 9      0 0 0 0 0 0 1 0 - 0  0
10      0 0 0 0 0 0 0 0 0 -  0
11      0 1 1 0 0 0 1 1 1 1  -
```

Raw cells include similarity mean/p5/p50/p95, maximum progress, terminal phase/reason and training calibration. A progress value near 100 without completion is not counted as success. Full matrices and eligibility histories: `fitted-full-invariant-landmarks.json`, `fitted-full-kinematic-balanced.json`, `fitted-full-gram-balanced.json`, `fitted-full-kinematic-predictable-channels.json`, `covariance-teacher.json`. The same-recording shared segmentation is a remaining validation limitation even though scoring/reference selection excludes the held-out execution.

### Learner and Negative Evidence

Frozen reduced-candidate **offline replay of unchanged cached learner poses**, not a new production model: results are identical at 20/50/75/80/100. Front attempt 1: zero repetitions, **68.8735% maximum ordered progress**. Front attempt 2: one repetition, 100%. Side attempts 1 and 2: one each, 100%. Complete recording: **three REP_SUCCESS events** at every level, approximately 16.91/26.24/31.04 s. Difficulty density does not require visiting every exact source frame. No expectation of four repetitions is imposed.

Setup/walking, between-attempt turn/standing, exit, static starting pose and outbound-only partials each produce **zero repetitions at all five levels** in that candidate. Generic dance uses the same cursor in sequence mode: one completion at each level; reversed sequence zero; no learner dance validation. These limited negatives are not proof of arbitrary-motion discrimination.

**Decisive counterexample:** a generic synthetic arm cycle moving forward versus backward produces exactly identical reduced inclination/flexion descriptors (maximum distance **0**). Both complete the taught reference at difficulty 100 using teacher-only nearby calibration. Complete body XYZ separates these trajectories by maximum distance **0.707107**; Gram/chirality by **0.188982**; XYZ/flexion by **0.353553**. The synthetic collision is not presented as real-video model evidence; it proves information is discarded by the descriptor. No threshold can recover the missing direction. Therefore the three learner repetitions cannot justify promoting that reduced representation for arbitrary human movement.

Known views, reporting only: early front teacher sources 1-3 generalize better in the reduced matrix. The long side episode 4 has no held-out completion. Late side proposal 11 matches front 2/3 in the reduced candidate, but its fuller geometry remains inconsistent against most sources. Side shallow episodes and chair/arm variations are not interchangeable clean demonstrations. Reduced learner matching does **not** establish viewpoint-invariant full-body matching. The four learner windows are diagnostic annotations only.

Primary learner/collision files: `invariant-landmarks-learner.json`, `representation-collision.json`; prior failure including exit false positive: `candidate-v5-evaluation.json`. No production learner threshold, view switch, action label, timestamp branch or filename branch is added.

Actual production streaming was also run, separately from the reduced candidate: unchanged learner file -> LearnerVideo -> LivePoseLoop -> RTMW3D detector -> HTTP worker/LocalAlignment -> LearningRun, with the frozen observed-region browser T2 canonical. This previously constructed diagnostic canonical bypasses the failing fresh automatic compile; it is not substituted silently for successful teaching. At difficulties **20/50/75/80/100**, repetitions **0/0/0/0/0**, maximum progress **0/0/0/0/0%**. All four annotated attempts and setup/turn/exit have zero progress and zero repetitions. Negative non-completion in this run is not meaningful discrimination success because the positives fail too.

Delivered/usable frames by difficulty: **389/331, 457/415, 472/418, 516/458, 472/419**. Calibration window starts: **4795.165, 6565.052, 4806.833, 7721.196, 7725.161 ms**. Each run rewound to **0**, requested **no camera**, terminated automatically at EOF and emitted **exactly one final evaluation**, without a Finish click. All retain angleWeight 0 and local_trajectory alignment. Different processed frame counts reflect actual live inference cadence, not density-derived progress. Raw per-frame geometry, events and diagnostics: `production-learner-{20,50,75,80,100}.json`.

The separate actual UI lifecycle regression also passes on an older saved v3 point-reference lesson, not a freshly compiled lesson: 256 delivered/222 usable frames, zero repetitions, one calibration/start/evaluation per run, rewind zero, automatic EOF and zero getUserMedia calls. Visible canvas pixels: 37042; desktop/mobile checks pass. Calibration-start to final evaluation takes **45.401 s**, of which active run to EOF takes **36.613 s** for the 36.436 s media. These are lifecycle/performance results, not successful movement acceptance. `test-results/movement/upload-lifecycle.json` preserves the timestamped events.

### Performance, Licensing and Scope

Valid 994-frame teacher probes, mean/p95 inference milliseconds: Full CPU VIDEO **52.817/64.900**; Heavy GPU VIDEO **26.363/29.700**; Heavy GPU IMAGE **42.021/46.900**. Total seek/extraction elapsed: **67.343/40.668/59.168 seconds**, respectively. These local CPU and GPU runs establish model operation, not production CPU fallback or end-to-end learner correctness. Production RTMW3D Level B extraction processed 994 teacher frames in approximately 102.233 s in the current shared-machine run.

Frozen five-reference reduced diagnostic at difficulty 100: **2.0975 ms mean / 4.5032 ms p95** for 534 learner observations, excluding inference/HTTP/rendering. Current six-active-reference production synthetic stress, measured while browser inference was running: **5.5815/12.4437 ms**. Retained six-source teacher set has only five active references: **0.4597/1.5656 ms**, not mislabelled six active. The earlier 2.3 ms local versus 248 ms DTW benchmark remains historical evidence. Performance is not the current blocker; correctness is.

A second production timing run, also on the shared dev machine, measures six active synthetic references at difficulty 100 at **4.0322 ms mean / 7.2805 ms p95**, ten naturally completed replays. Its unchanged six-source/five-active teacher load measures **0.4989/1.8845 ms**; these are timing cases, not generalization certification. Both performance JSONs are preserved under `final-generic/`.

MediaPipe Full/Heavy task assets are the official float16 version-1 downloads. The [official BlazePose GHUM model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf) states Apache-2.0 licensing, single-person scope and inferred, non-metric depth limitations. Asset hashes are recorded in `final-generic/summary.json`. This does not resolve RTMW3D's separate checkpoint/training-data rights noted in `RTMW3D_MODEL.md`. The OAS experiment implements the published shrinkage method locally with NumPy; [primary estimator documentation](https://scikit-learn.org/stable/modules/generated/sklearn.covariance.OAS.html) describes its reference formula. No scikit-learn dependency was installed.

No alternative has been selected for release, so deleting compatibility paths or declaring a new production architecture would be premature. Unused DTWProgressTracker remains unimported; offline DTW evidence remains. New experimental feature/segmentation/cursor/calibration scripts are explicitly diagnostic-only. Heavy weights are moved from `public/models` to ignored `data/diagnostic-models`, excluded from the production bundle, and used only by the explicit probe. No site deployment, git push, proprietary inference requirement or fixture-specific production mode is introduced.

### Files and Remaining Blocker

Production edits this task: `src/frontend/pose/pose.types.ts`, `src/frontend/lesson/ReferenceMovementBuilder.ts`, `src/frontend/lesson/LessonSchema.ts`, `src/backend/routes/movement.ts`, `src/movement/local_alignment.py`. Regression updates: `tests/unit/TeacherMotionEvidence.test.ts`, `tests/movement3d/test_anchor_regions.py`, `tests/movement3d/test_local_alignment.py`.

Offline additions: `motion_features.py`, `compare_teacher_representations.py`, `segment_experiment.py`, `trajectory_experiment.py`, `fit_causal_candidate.py`, `evaluate_causal_candidate.py`, `representation_collision.py`, `covariance_experiment.py`, `summarize_final_evidence.py`, `validate_frozen_candidate.py`; extraction probe `src/scripts/level-b/probePoseRepresentation.ts`; probe regressions `tests/movement/representation-probe.spec.ts`, `tests/movement/production-evidence.spec.ts`, `tests/movement3d/test_representation_diagnostics.py`. Existing `validate_anchor_regions.py` reports zero implicit holds; `benchmark_local_alignment.py` accepts an output path so historical evidence is not overwritten. README and this existing report are updated. Other dirty files predate this task and are not claimed as new work.

`.gitignore` excludes diagnostic-only Heavy model assets. Full model SHA-256 `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1`; Heavy `64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b`. The production build contains no Heavy asset.

### Software Validation and Webcam Regression

Final distinct successful checks: **229 tests**, with **three remaining failed real-upload tests** and **three dependent Level B tests not run**. Software totals do not certify movement acceptance.

- TypeScript unit tests: **130/130**, 32 files. Python movement tests: **82/82**, including explicit optional-hold continuity, transient unheld anchors and the reduced-descriptor collision regression.
- Frontend/backend typechecks, ESLint and production build pass. Three pre-existing Fast Refresh warnings and existing chunk warnings remain. Initial diagnostic TypeScript errors were corrected; failed logs/results are not treated as passing runs.
- Ordinary E2E: final **11/11** pass, `final-generic/e2e-storage-ready/`. Two earlier whole-suite runs passed ten and failed the damaged-lesson log assertion because remote/local storage loading had not finished. An isolated retry passed. The test now waits for the existing STORAGE_READY signal before asserting the damaged lesson is absent and LESSON_INVALID is reported. Neither rejection assertion nor any movement threshold was weakened; the final damaged-record check takes 11.4 s. Earlier error contexts remain in `e2e/` and `e2e-final/`.
- Level B: **3 pass, 2 fail, 3 dependent tests do not run**. Passing: real voice session teardown, fake-camera live Teach (48 recorded poses over 17.767 s; video download), camera/microphone/loop release on returning Home. Failed: real-upload semantic pipeline and upload Teach Work Map, both at the existing "No demonstration has reliable 3D semantic anchors" construction blocker. Saved-lesson/live-Learn follow-ups are serially blocked. No real-hardware webcam learner validation or successful v3 live-Learn acceptance is claimed.
- Movement upload suite: **1 pass, 1 fail**; two explicit diagnostics are skipped in that normal invocation. Passing: actual uploaded-learner UI lifecycle/EOF/canvas/mobile/no-camera checks on the older persisted v3 lesson. Failed: fresh teacher compilation/difficulty-matrix case, before learner evaluation, for the same construction blocker. No assertion is removed to make teaching pass.
- Controlled model probe: **1 pass** comprising three valid teacher extractions. Explicit frozen-reference production learner probe: **1 pass** comprising all five difficulty levels, EOF once/no camera/rewind assertions. These pass their diagnostic/lifecycle assertions while reporting **zero production movement acceptance**; they are not positive recognition tests.
- Direct empirical self replay, teacher-held-out matrices, temporal resampling, frozen learner/negative replays, dance and timing scripts are additional evidence, not inflated into software-test totals. `git diff --check` passes.

Reproduction with the preserved input caches and frozen evidence (output directories are local/ignored, not shipped models or release artifacts):

```powershell
npm run verify
.venv-movement/Scripts/python.exe -m pytest tests/movement3d -q
node_modules/.bin/playwright.CMD test --config=playwright.config.ts --workers=1
node_modules/.bin/playwright.CMD test --config=playwright.level-b.config.ts
node_modules/.bin/playwright.CMD test --config=playwright.movement.config.ts
$env:MOVEMENT_REPRESENTATION_PROBE='1'
node_modules/.bin/playwright.CMD test --config=playwright.movement.config.ts --grep 'controlled teacher-only'
$env:MOVEMENT_PRODUCTION_PROBE='1'
node_modules/.bin/playwright.CMD test --config=playwright.movement.config.ts --grep 'diagnostic frozen reference'
.venv-movement/Scripts/python.exe src/movement/evaluate_causal_candidate.py --frozen fitted-full-invariant-landmarks.json --name new-frozen-replay
.venv-movement/Scripts/python.exe src/movement/covariance_experiment.py
.venv-movement/Scripts/python.exe src/movement/summarize_final_evidence.py
```

Earlier prototype source versions are preserved in `final-generic/before/`; later balanced/channel/covariance changes must not be used to claim byte-identical recalibration of the earlier pooled candidate. Its frozen calibration and original matrix remain the evidence. Other runtime/source changes predate this task; `tests/e2e/error-paths.spec.ts` additionally has the storage-readiness synchronization correction described above.

- **Critical:** no validated representation/calibration currently preserves directional whole-body geometry while providing sufficient held-out teacher generalization and resampling robustness. Production still fails its eligible cycle self-replay and automatic teacher compile.
- **High:** reduced descriptor demonstrably aliases different movements; full geometry alternatives still miss teacher executions. Production segmentation/eligibility/landmark inference are not replaced. A complete production teacher-to-learner run is not certified.
- **Medium:** segmentation needs independent extraction-cadence validation; existing six windows are cropped/grouped, not clean physical-cycle ground truth. CPU model operation is measured but no new production fallback is shipped. Diagnostic front attempt 1 remains incomplete. Finite teacher evidence cannot establish arbitrary-movement coverage.
- **Low:** existing lint/chunk warnings and hosted worker deployment remain unresolved.

This is the smallest supported stop: the reduced representation's information loss is proved, and the evaluated complete-geometry alternatives fail independent teacher/resampling evidence. It is **not** a claim that all future local pose models or metrics must fail. Safe hold removal and reproducible evidence are delivered; generic movement learning remains **NOT READY**.

## 24. Production MediaPipe Heavy MVP

Implemented 2026-10-05 following the final implementation specification. Sections 1-23 above are historical evidence, not current runtime documentation. No prior failures, RTMW3D/DTW evidence, or diagnostic assets were removed. New raw empirical outputs are in `test-results/movement/heavy-v1/`; these local, ignored files are intentionally preserved, not bundled release fixtures.

### Final Architecture

New teaching, uploaded learning, and webcam learning use the same browser/TypeScript path:

```text
MediaPipe Heavy VIDEO -> anatomical body-relative 3D -> teacher-only OAS
-> independent observed teacher trajectories -> causal LocalAlignment
-> ordered progress / aligned ghost / confidence-aware coaching / completion
```

- Asset: official float16/version-1 `pose_landmarker_heavy.task`, 30,664,242 bytes, SHA-256 `64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b`. The bundled asset is verified during dev/build preparation. Local WASM comes from the locked `@mediapipe/tasks-vision` version 0.10.35. No CDN, Python worker, CUDA, ONNX Runtime or discrete GPU is needed for normal new lessons. GPU initialization falls back to CPU; forced CPU was exercised on the complete teacher video.
- Representation: `mediapipe-heavy-body3d-v1`, separate from legacy 2D and `rtmw3d-body-v1`. Twelve joints: anatomical left/right shoulders, elbows, wrists, hips, knees, ankles, MediaPipe indices 11/12/13/14/15/16/23/24/25/26/27/28. Full normalized joint geometry is retained for provenance/display.
- Scored descriptor: 48 channels, twelve unit bone vectors XYZ plus twelve parent-bone dot-product flexion values. Bones: left/right hip-to-shoulder, shoulder-to-elbow, elbow-to-wrist, hip-to-knee, knee-to-ankle, shoulder span and hip span. Bone parents in that order: shoulder span/shoulder span/left torso/left upper arm/right torso/right upper arm/hip span/left thigh/hip span/right thigh/hip span/shoulder span. Flexion is integrated geometry, not a separate hard angle gate; `angleWeight` remains zero.
- Normalization: hip midpoint root; scale is max(torso length, 1.8 hip width); anatomical shoulder-plus-hip lateral direction projected horizontally determines yaw, with camera down as vertical and cross-product forward. No automatic mirroring or left/right swaps. Translation, positive uniform scale and intended yaw invariance are tested. This is not full roll/pitch or viewpoint-invariant metric motion capture.
- Missing/nonfinite/zero-confidence observations remain null geometry with zero confidence. Finite low-confidence observations retain their value but are downweighted/masked for scoring. Six reliable bones and reliable shoulders/hips are required for a usable frame; one missing wrist does not invalidate the whole body. Whitened output channels affected by missing inputs are masked, not treated as observed zero poses.

The opposite-direction synthetic arm counterexample from section 23 is now distinguishable: forward/back production feature vectors differ, and the backward cycle does not complete the forward reference. All 48 channels remain; no reduced inclination-only descriptor is used for scoring.

### OAS and Frozen Teacher Calibration

Calibration accepts only confirmed good teacher demonstrations. Positive feature reliability weights are the per-source-balanced mean confidence, with a generic 0.2 floor. Residuals compare teacher observations with the nearest other teacher observation within +/-0.1 normalized geometric-arc position; a one-source dataset uses adjacent-observation residuals and persists that fallback. Missing residual channels contribute no invented pose geometry; confidence masks remain associated with the observed poses.

The 48-dimensional implementation uses zero-centered residual second moments, OAS shrinkage toward trace/dimension identity, a numerical ridge, and inverse Cholesky whitening. The whitening factor is normalized by its Frobenius RMS, preserving all dimensions while setting a reproducible distance scale. Tests verify deterministic finite singular/small-data handling and `W covariance W^T = scaled identity`. This follows the [primary OAS estimator formulation](https://scikit-learn.org/stable/modules/generated/sklearn.covariance.OAS.html), with the residual model explicitly assumed zero-centered; no scikit-learn/Python dependency is required by production.

Noise is median adjacent teacher distance. Acceptance tolerance is max(median of per-source p95 cross-source residual distances, twice teacher noise, numerical floor). It is not 0.3125, not Match Difficulty, and not chosen from learner success. Calibration persists teacher IDs, sample count, all weights, covariance, whitening matrix, shrinkage, tolerance, noise and fallback.

Frozen cycle calibration: 288 teacher observations, shrinkage **0.01341060335**, noise **0.00860987709**, geometric tolerance **0.04147041149**, no single-source fallback. Calibration-only SHA-256: `9baf637eb1f752b15f39ccd92cc8d8ef0117f4e24f8242fd94d9383f560173cc`. Full representation/calibration/references/segmentation freeze SHA-256: `bb3cc8608b160f8dd4e97ccd6de8476c7c1553f1a8b3061cc940a355bdbfdf9e`, created before any new learner evaluation. Learner tests verify that hash before and after every matrix run. No weights, tolerance, segmentation, eligibility, reference, or matching parameter was changed after reading the learner results.

### Segmentation and Reference Construction

Section-23 recurrence/PCA hysteresis is now production teacher proposal construction. Its scalar segmentation signal uses inclination and flexion only; the scored/reference geometry still retains full XYZ. Teacher-only movement SNR, a fixed-time noise lag, time-supported latent rest density, scalar smoothing, excursion hysteresis, and confidence-gap continuity produce proposals. This signal does not infer movement semantics. Open/disconnected/tracking-gap episodes are fragments. Teacher review remains authoritative; the test harness explicitly simulates confirmation, not human ground truth.

The latest fresh Heavy extraction contains 994 observed teacher frames. Eight proposals, milliseconds:

```text
0-6133       fragment: initial open episode
7933-10400   coherent proposal -> harness-confirmed -> eligible T1
12867-15667  coherent proposal -> harness-confirmed -> eligible T2
18200-20733  coherent proposal -> harness-confirmed -> eligible T3
30200-38867  coherent proposal -> harness-confirmed -> eligible T4
42400-43733  fragment: disconnected/open episode
57267-58733  fragment: disconnected/open episode
59733-62133  coherent proposal -> harness-confirmed -> eligible T5
```

Five confirmed references, not six forced repetitions. T4 is a long heterogeneous side episode; coherent geometry and successful self-replay do not prove it is one pedagogically correct repetition. A real teacher must reject/trim/re-record inappropriate proposals. The three fragments were not accepted by the harness. Generic proposal-quality details remain in analysis diagnostics, and reference-specific rejection reasons remain persisted.

Each reference retains its own complete ordered source observations/timestamps/confidence/root/scale/basis, source demonstration ID, selected observed indices, arc length/excursion/noise, maximum gap, neighbor-transition error, start/terminal indices and eligibility reasons. Reliable observed RDP knots are selected at the teacher-calibrated geometric resolution; selected samples contain exact source bodies, never coordinate averages. T1-T5 have **5/4/4/8/3** retained actual-source knots. Interpolation of features for local projection/runtime targets is distinct from source observations. Large gaps (>1000 ms), nonmonotonic timestamps, insufficient excursion, or isolated geometry inconsistent with adjacent transition support reject a reference.

Initial implementations are not retroactively claimed successful. Full-XYZ segmentation merged early episodes; dropping all low-confidence geometry then made valid proposals fragments. A later noise-only simplification let one long source stall near **94.6%** during exact self-replay. Generic construction was corrected before learner evaluation by preserving measured confidence and simplifying at teacher-calibrated geometric resolution; no geometric acceptance radius was loosened from learner outcomes. `before-segmentation-correction/` and `self-trace-3.json` preserve failed evidence.

### LocalAlignment and Generic Semantics

Each accepted reference owns an independent causal cursor. Compatible observed start geometry starts an attempt. Projection searches current position through at most +0.25 geometric arc, chooses supported nearby geometry, and never regresses or globally searches the remaining trajectory. Geometric travel is bounded by the observed transition plus calibrated uncertainty. Crossing sampled targets or retained source knots requires support by the actual previous-to-current observation segment. Directional support is required when motion exceeds measured teacher noise. Tracking gaps, disconnected observations and unsupported episodes cause explicit restart/reacquisition. No accumulated learner history, DP, FPS-derived skip budget, elapsed teacher time, or cross-reference phase borrowing determines progress.

Generic cycle and sequence semantics are start -> ordered trajectory -> observed terminal. There is no mandatory apex, outbound/return landmark or 150 ms generated dwell. Generated start/completion holds are zero; explicit `holdSource: "teacher_requested"` holds require compatible observations across actual time. A sparse observation can support the locally bounded terminal tail; merely matching endpoints, standing still, reversing asymmetric movement or showing disconnected poses does not complete synthetic tests. Cycles emit once and reset for a new compatible start; sequences emit once and never wrap.

Match Difficulty remains 1-100/default75 and changes only runtime target density. Exact helper text is unchanged. Removing the invented apex changes runtime counts at **1/20/50/75/80/99/100 to 3/3/3/5/6/101/101** for these generic paths. The five UI checkpoints are previews, not independent phase anchors.

Ghost geometry is taken from the nearest actual teacher knot to the currently aligned candidate position and projected into learner hip/scale/anatomical framing. Low-confidence or missing joints are invisible, not drawn from the image origin. Coaching compares the same reliable XYZ/flexion channels, selects one largest meaningful deviation, and emits generic lateral/vertical/forward/back/bend/straighten instructions. Existing cue throttling remains; unreliable geometry suppresses corrections.

### Real Teacher and Dance Results

Exact source self-replay through the production online tracker at difficulty **20/50/75/80/100: 5/5 at every level**, exactly one REP_SUCCESS per source. At 75: endpoint-preserving 0.5x, normal, 2x and small internal drops each **5/5**. Static start and first-half partials each **0/5** completions. Additional raw `[::2]` decimation that omits one source's terminal observation is **4/5**, not relabelled a passing robustness test. It loses terminal evidence; this limitation is preserved alongside the passing endpoint-preserving half-density experiment.

Teacher cross-demonstration completion matrix at 75, row execution/column independent reference, T1-T5 in the order above:

```text
       T1 T2 T3 T4 T5
T1      1  0  0  0  0
T2      0  1  1  0  0
T3      0  1  1  0  0
T4      0  0  0  1  0
T5      0  0  0  0  1
```

Two non-identity pairings pass, eighteen do not. This uses the complete taught teacher calibration, **not leave-one-out calibration**; all executions come from one recording, not independent devices/sessions. T2/T3 are visually early front-view demonstrations; the long/later side sources do not generalize here. View labels are diagnostic only and never select geometry or parameters. At 75, completion distances T1-T5 are **0 / 0.0180398 / 0.0300301 / 0.0361370 / 0.0243416**, each within the frozen teacher tolerance. Full matrices, reasons, events and temporal variants are in `teacher-validation.json`.

Dance was freshly extracted as one full observed sequence: 153 frames, 0-10133 ms, 24 retained observed knots, no apex, no mandatory dwell, single-source calibration fallback persisted, tolerance **0.02766808625**. Self-replay emits exactly one SEQUENCE_COMPLETE at every requested difficulty, with terminal-supported completion at 9733 ms (not EOF-as-success), distance **0.0210890**. Reversed trajectory emits zero; two concatenated executions still emit only one/no wrap. No student dance recording exists and none was fabricated.

### Frozen Learner and Real Negatives

Unchanged learner file was run through LearnerVideo -> Heavy VIDEO -> LivePoseLoop -> LearningRun -> the same production HeavyProgressTracker. Full recording, difficulty order 20/50/75/80/100:

- REP_SUCCESS: **0/0/0/0/0**.
- Maximum ordered progress: **49.4659 / 15.9839 / 15.1264 / 49.4659 / 17.0012%**.
- Delivered/usable poses: **509/509, 547/547, 547/547, 534/534, 526/526**. Actual inference cadence differs; these are separate real playback runs, not evidence that changing difficulty alone caused every progress difference.
- Frozen geometric tolerance is identical at all levels. Completion distance/similarity is **not applicable: no completion**. The main advancing candidate is T5, ID `e6911e8d-f2f6-4175-84f3-ce2c44d848e0`; no progress is borrowed from T2/T3.
- Dominant failure reasons: awaiting compatible start, local mismatch, unsupported-episode restart. T2/T3 each restart once; T5 restarts 3/2/2/3/2 times respectively. At 100, disconnected observations are also recorded. These are diagnostic matcher episodes, not certified physical attempt boundaries.

Approximate reporting-only windows are front1 9-14 s, front2 14-18 s, side1 23-28 s and side2 28-33 s. Both continuous traces and independently initialized window replays give **zero repetitions for every window at every difficulty**. Front1/front2/side1 each have zero ordered progress. Side2 maximum progress is the full-recording maximum listed above, toward T5; it stalls/restarts rather than completes. Cropped windows may omit valid start context, so full continuous traces are preserved as the primary result. No start/view/window labels enter matching or calibration.

Setup/walking (0-9 s), turn/standing (18-23 s), and exit (33 s-EOF): **zero false full completions at all five difficulties**. Independently initialized negative windows each have zero ordered progress. Continuous exit sometimes retains **2.0515/3.2975/2.8641%** progress at difficulty 50/80/100 from an ongoing incomplete episode; this is not hidden as zero continuous progress. Static/partial teacher controls and asymmetric reverse/opposite-direction synthetic controls reject completion. Since learner positives fail, real-negative non-completion is limited discrimination evidence, not universal recognition proof. Raw per-frame poses and diagnostics remain in `learner-{difficulty}.json` and `learner-validation.json`.

### Lifecycle, Performance and Licensing

The frozen matrix test checks: teacher hash unchanged; no `getUserMedia`; no `/api/movement` requests; observed stable calibration; rewind to zero; automatic EOF; exactly one final evaluation per stable run ID. Calibration starts from observed frames, not invented neutral poses. Calibrated learner data is used for framing/readiness, never teacher OAS fitting.

Model inference timings on this Windows Chromium/dev machine:

- Heavy CPU VIDEO: mean **164.177 ms**, p95 **180.100 ms**, approximately **6.09 inference FPS**; complete 994-frame teacher extraction **176.665 s**, feature construction mean **0.0381 ms**. CPU functionality is demonstrated, not 15 FPS CPU performance.
- Heavy GPU VIDEO: mean **32.762 ms**, p95 **39.800 ms**, approximately **30.52 inference FPS**; 994-frame teacher extraction **53.177 s**, features mean **0.0560 ms**. Dance GPU mean **31.125 ms**, p95 **34.200 ms**, extraction **7.712 s**.
- Offline production-core benchmark at difficulty100: one reference **0.0504 ms mean / 0.0859 ms p95**; five active references **0.1865 / 0.3037 ms**; OAS transform **0.0258 ms mean**. These exclude inference/rendering and are local measurements, not a device-independent guarantee. There are five real active references, not six falsely claimed.
- Learner total initialization/calibration/playback/EOF wall times: **53.607/44.245/44.338/46.116/49.418 s** for 36.436 s media. The active stream runs on the media clock; CPU may skip observations rather than fabricating progression.

The [official MediaPipe web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js) documents VIDEO inference and its synchronous browser execution. The [official BlazePose GHUM model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf) states Apache-2.0 and single-person/inferred non-metric depth limitations. `public/models/MEDIAPIPE_NOTICE.md` records the exact asset and provenance. No broader dataset/model rights are asserted; RTMW3D rights remain separately documented for optional compatibility.

### Compatibility and Isolation

New lessons do not instantiate RTMW3DPoseDetector or call the Python movement endpoint. Existing RTMW3D lessons still use their explicit detector, local-alignment worker and old semantic anchors; existing legacy 2D lessons retain Full/2D matching. Schema parsing rejects mixed Heavy/RTMW/legacy canonical geometry. Old files are never silently migrated. The default Docker image is Node-only; the explicit `INSTALL_RTMW3D_COMPAT=true` build argument retains optional Python support. Docker image execution is not yet validated in this run.

DTWProgressTracker has no production caller and is marked historical. DTAIDistance and old experiments remain offline/compatibility evidence, not live progression. Legacy apex/anchor-region compatibility remains, but new Heavy references depend only on reliable ordered source observations/start/terminal evidence. No production action, view, fixture filename, expected repetition count, or known fixture timestamp branches were added.

### Software Validation

The current implementation passes typechecks, lint (zero errors, three existing Fast Refresh warnings), unit regressions and production build. The expanded focused Heavy suite has 23 passing tests; final full-suite totals and browser workflow results are recorded below after completion. Python compatibility/offline tests: **82/82**. The fresh teacher/model probe and frozen learner-browser matrix both pass their explicit assertions; learner movement acceptance remains zero and is not converted into a software failure or success claim.

### Files Changed in This Implementation

Added production files:
`src/shared/movement/HeavyBody.ts`, `OAS.ts`, `heavySchema.ts`; `src/frontend/analyze/HeavySegmentation.ts`; `src/frontend/lesson/HeavyReferenceBuilder.ts`; `src/frontend/learn/HeavyProgressTracker.ts`; `src/scripts/preparePoseAssets.mjs`; `public/models/pose_landmarker_heavy.task`, `public/models/MEDIAPIPE_NOTICE.md`. Generated `public/models/wasm/` is ignored and reproduced from npm.

Modified production/integration files:
`src/frontend/pose/pose.types.ts`, `PoseNormalizer.ts`, `PoseDistance.ts`, `PoseDetector.ts`, `useLivePose.ts`; `src/frontend/analyze/VideoPoseExtractor.ts`, `CycleAnalyzer.ts`, `SequenceAnalyzer.ts`, `analyze.types.ts`; `src/frontend/lesson/CanonicalMovementBuilder.ts`, `RuntimeTargets.ts`, `LessonSchema.ts`; `src/frontend/learn/LearningRun.ts`, `LearnerVideo.ts`, `LearnFlow.tsx`, `ghostPose.ts`, `PoseDeviation.ts`, `CoachingSession.ts`, `StudentCalibration.tsx`, `DTWProgressTracker.ts` (historical annotation only); `src/frontend/calibration/CalibrationFlow.tsx`; `src/scripts/level-b/runMovementValidation.ts`; `package.json`, `.gitignore`, `Dockerfile`, `README.md`, this report.

Added validation files:
`tests/unit/HeavyMovement.test.ts`; `tests/movement/heavy-architecture.spec.ts`, `heavy-learner.spec.ts`; `src/scripts/level-b/validateHeavyTeacher.ts`, `recompileHeavyTeacher.ts`, `traceHeavySelf.ts`, `reportHeavyLearner.ts`. Updated `tests/movement/position-matrix.spec.ts` to assert coherent observed knots plus dense runtime targets instead of a legacy raw-knot minimum; `tests/level-b/live-flows.spec.ts` expects five generic preview checkpoints instead of nine apex previews. Lifecycle/semantic coverage thresholds are not lowered. Other dirty files predate this task and are not claimed as new work. No source files or historical evidence were removed; no deployment/commit/push was performed.

### Remaining Limitations and Status

- **Critical:** none demonstrated that prevents the selected architecture from functioning. Complete directional geometry, fresh coherent teacher compilation, natural teacher self-replay, temporal robustness, generic sequence completion, and limited cross-execution recognition work.
- **High:** independently recorded learner recognition remains **zero** for this fixture; only two of twenty non-identity teacher pairings complete. This is not general-purpose movement accuracy certification. Start-state/body-shape/depth variation remains restrictive. Teacher calibration is not an independently validated population metric.
- **Medium:** CPU is functional but about 6 inference FPS here; synchronous inference can block UI. Segmentation can propose long semantically heterogeneous episodes requiring teacher judgment. Terminal-omitting decimation misses one source. Native/extraction/playback cadence affects inferred 3D geometry. Validation uses one teacher recording and no learner dance or real-hardware webcam capture.
- **Low:** existing lint/bundle-size warnings remain. Container build/runtime and deployment are not validated by this implementation task.

**Final Product Status: MVP MOVEMENT PIPELINE WORKING WITH LIMITATIONS.** This is an implemented, chosen production architecture, not a claim that arbitrary human movement recognition is solved. Teacher self-consistency and usable teaching/lifecycle behavior are distinct from the preserved poor learner generalization results; no learner tuning was used to make those failures disappear.

## 25. Simplified Articulated Skeleton Implementation

### Pre-Implementation Inventory

The replacement specification arrived during section-24 browser regressions. The in-flight ordinary suite was stopped before architecture edits; partial results are not a completed regression pass.

Retain: bundled Heavy VIDEO/world inference and CPU fallback; twelve major joint definitions and confidence masks; independent observed teacher demonstrations; runtime density control; cycle/sequence event types; LivePoseLoop, LearningRun, LearnerVideo, stable run IDs, rewind/EOF; ghost/coaching infrastructure; persistence and explicit legacy/RTMW/section-24 Heavy compatibility; lifecycle tests and all three fixture videos. The current worktree already contains extensive unrelated/prior modifications, which remain untouched.

Isolate from the new representation: OAS and teacher fitting, RTMW reconstruction/focal lengths, observed semantic anchor-region inference, required apex/generated dwell, full-history DTW, median bodies, descriptor experiments and diagnostic view/action/window annotations. These remain historical evidence or explicit compatibility only.

Implement a distinct `mediapipe-articulated-3d-v1` path: anatomical pelvis/shoulder body frame, unit 3D bones and bend angles; fixed interpretable angular metric/tolerance; independent source references; causal guidance plus a bounded completed-candidate alignment scorer. One observed execution can compile directly without automatic long-video segmentation or cross-demonstration fitting. Automatic upload segmentation remains an optional proposal convenience, never the sole way to construct a reference.

### Production Architecture and Descriptor

NEW lessons use browser-local MediaPipe Heavy VIDEO. Old 2D, RTMW3D and section-24 Heavy/OAS representations route explicitly to their existing compatibility implementations. No RTMW request, covariance, teacher fitting, inferred apex, generated hold, action/view label or fixture boundary controls articulated matching.

Root is pelvis midpoint. Up is pelvis-to-shoulder midpoint; lateral combines anatomically ordered hip and shoulder spans; forward is cross(lateral, up), right is cross(up, forward), all normalized. Twelve major joints supply eleven unit bones: torso; bilateral upper arms, forearms, thighs and shins; shoulder and hip spans. Eight bends are bilateral elbow, shoulder, hip and knee articulations, calculated as pi minus the angle between adjacent bones. Direction vectors preserve opposite forward/back movements; angles alone do not define similarity. Display coordinates retain normalized joint geometry, not metric reconstruction.

Mutually confident bone error is acos(clamped dot(unitA, unitB))/pi. Bend error is abs(angleA-angleB)/pi. Pose mean distance is 0.75 mean bone error + 0.25 mean bend error. Confidence remains 0.3, with at least six common major bones and reliable anatomical frame. Missing or degenerate geometry supplies no evidence; a missing wrist is not an entire-person loss. Translation, uniform scale and rigid body-frame yaw invariance, bend distinction, unit lengths and opposite-direction rejection pass synthetic tests. This verifies the math, not model invariance under real camera changes.

The principal acceptance constant is **ARTICULATED_TOLERANCE = 0.25**, corresponding to 45 degrees normalized angular error; final similarity requirement is >=0.75. No learner-derived weights/radii or statistical calibration. Completed alignment retains per-feature diagnostics. Its final distance is the maximum of mean pose distance, worst mean feature error, and worst teacher-stage support error along the monotonic alignment. Stage support is the smallest worst-feature error for observations aligned to each teacher stage. This uses the same tolerance and prevents ten static bones from diluting an opposite-moving arm; it was established by the synthetic opposite-direction test before learner evaluation.

One confirmed coherent execution builds one reference directly. Geometric arc uses worst mutually supported angular change. Endpoint-preserving simplification at tolerance/8 retains actual observed source knots and important turns, without coordinate averaging or elapsed-time states. Live Teach records one execution; long upload segmentation remains an optional proposal/review convenience. Diagnostic teacher clip boundaries below never enter production matching. Generated start/completion holds are zero; only explicit teacher-requested holds dwell.

Live guidance owns one independent monotonic cursor per reference, searching current position through a bounded +0.25 region. Ghost selects the nearest actual teacher knot, not a median or elapsed-time pose; coaching uses anatomical bone/bend degree errors and existing throttling. Completion does not depend on this cursor visiting every target. A bounded candidate starts near reference start, accumulates meaningful descriptor excursion/travel, and is evaluated when observed terminal geometry is locally most compatible. Missing intervals supply no motion; >1 second tracking gap restarts. Candidate storage is <=100 geometrically sampled observations and <=60 seconds. Cycles reset on either accepted or rejected completed attempts; sequences complete once/no wrap.

Completed-only multidimensional DTW aligns <=100 candidate observations with <=100 teacher observations, using a fixed 0.35 normalized-sample-index band and closed start/end. It is not accumulated-history online DTW. Each reference scores independently; no phase borrowing. Scoring retains geometric teacher turns plus runtime detail. Difficulty changes density only; counts at **1/20/50/75/80/99/100 are 3/3/3/5/6/101/101**. Retained structural turns remain at low difficulty rather than throwing away the taught path.

### Teacher Gates and Cross-Execution Evidence

All three expected fixtures were confirmed. Their exact bytes/model provenance remain documented in section 24. Raw Heavy world observations from that actual extraction are converted using the new production descriptor, not section-24 reference geometry or covariance. Teacher-only diagnostic boundaries yield five eligible independent observed executions: T1 7933-10400 ms, T2 12867-15667, T3 18200-20733, T4 30200-38867 and T5 59733-62133. T4 is a long heterogeneous episode and requires teacher judgment. Retained actual knots: **16/13/14/38/13**. This separates matcher correctness from automatic segmentation quality.

Self replay: **5/5 exactly one REP_SUCCESS at each of 20/50/75/80/100**, 25 successful checks. Endpoint-preserving half density, normal density, double density and small internal drops: **5/5 each at 75**, 20 checks. Static and first-half partial trajectories: **0/5 completions each**. Initial mechanic failures (T1 low-density scoring discarded turns; dance reset on one changing limb) remain in `teacher-validation-initial.json`; generic fixes preceded the learner freeze.

Full natural execution x independent reference completion matrix at 75:

```text
       T1 T2 T3 T4 T5
T1      1  0  0  0  0
T2      0  1  1  0  0
T3      0  1  1  0  0
T4      0  0  0  1  0
T5      0  0  0  0  1
```

Two of twenty non-identity pairings pass; teacher demonstrations need not all match. This contains no cross-example fitting or view-selected parameters. T2/T3 are early/front-view examples; later side/heterogeneous examples fail cross-recognition. All sources are from one recording, not independent sessions/devices. Full distances and per-feature distributions are preserved in `articulated-v1/teacher-validation.json`.

Dance compiles as one full observed sequence, 153 source observations, without fabricated apex. Self replay produces **exactly one SEQUENCE_COMPLETE and no REP_SUCCESS at every requested difficulty**. Reversed execution produces zero; concatenating two executions produces only one/no wrap. No learner dance fixture exists and no learner dance accuracy is claimed.

### Freeze and Preserved Before Results

Teacher representation, tolerance and independent references were frozen before learner evaluation, SHA256 **c4d020ee6d4400fe913809b90ab5c71b9475156d2d192ffeaca13d4b33d443ff**. Model, descriptor, tolerance and reference geometry remained unchanged afterward.

Initial actual streaming produced **0/0/0/0/0** repetitions despite 100% live guidance at every difficulty. Independent fourth-attempt replay produced one, revealing that a rejected completed cycle kept its earlier trajectory buffer and contaminated subsequent attempts. The correction resets rejected completed cycles, preserves evaluation boundaries, and is covered by a generic wrong-cycle-then-correct-cycle synthetic regression. This is candidate lifecycle repair, not learner-based tolerance tuning. Raw BEFORE observations/reports are preserved under `articulated-v1/before-boundary-fix/`; failed browser startup evidence is also retained. Historical DTW/OAS failures are not rewritten as articulated results.

The same cached actual Heavy world observations replayed through the corrected new tracker give full-recording **1/1/1/1/1** and independent attempts **0/0/0/1** at all five difficulties. Whole-window diagnostic distances: front1 **0.456338**, front2 **0.467931**, side1 **0.279783**, side2 **0.183741**. These are diagnostics on the same cached pose stream, not five fresh inference runs. Whole-window scoring filters unsupported observations, matching the production candidate's confidence handling; initial null/Infinity reports from including unsupported poses are preserved rather than described as geometry matches.

### Files and Compatibility

Added core: `src/shared/movement/ArticulatedBody.ts`, `articulatedSchema.ts`; `src/frontend/analyze/ArticulatedTeaching.ts`; `src/frontend/lesson/ArticulatedReferenceBuilder.ts`; `src/frontend/learn/CompletedMovementScorer.ts`, `ArticulatedProgressTracker.ts`.

Integrated through existing `pose.types.ts`, `PoseDetector.ts`, `PoseNormalizer.ts`, `PoseDistance.ts`, `useLivePose.ts`, `VideoPoseExtractor.ts`, `CycleAnalyzer.ts`, `SequenceAnalyzer.ts`, `SessionAnalyzer.ts`, `CanonicalMovementBuilder.ts`, `RuntimeTargets.ts`, `LessonSchema.ts`, `LearningRun.ts`, `LearnerVideo.ts`, `LearnFlow.tsx`, `ghostPose.ts`, `PoseDeviation.ts`, `CoachingSession.ts`. Upload/webcam share the detector, descriptor and matching core. Persistence rejects mixed representations and retains old lessons without silently migrating them. Existing run IDs/calibration/rewind/EOF remain in the same lifecycle code. `LessonReview.tsx` now displays the saved screen after successful persistence without blocking on a full remote-library refresh; failure traces preceding that generic fix remain preserved.

Added evaluation: `tests/unit/ArticulatedMovement.test.ts`, `tests/movement/articulated-learner.spec.ts`, `src/scripts/level-b/validateArticulatedTeacher.ts`, `evaluateArticulatedLearner.ts`. Updated existing movement matrix/upload lifecycle checks and `runLevelBPipeline.ts` checkpoint expectations. README describes the new default and explicit compatibility. Other dirty worktree files predate this replacement and are not claimed as newly authored changes. No deployment, commit or push is part of this task.

### Frozen Actual Learner Results and Negative Controls

After the generic cycle-boundary repair, five fresh Heavy VIDEO/LearnerVideo runs at 20/50/75/80/100 produce **1/1/1/1/1 REP_SUCCESS**. Delivered observations: **503/542/540/533/525**. Maximum live guidance is 100% at every level; this is explicitly not equivalent to accepted ordered coverage. End-to-end wall times, including initialization/calibration/playback/EOF: **50.255/43.548/43.498/43.278/43.165 seconds** for 36.436-second media.

The winning independent reference is always T5, `e6911e8d-f2f6-4175-84f3-ce2c44d848e0`. Continuous accepted candidate boundaries (seconds), distances and similarities, in difficulty order:

- 20: **27.534-31.210**, distance **0.167023**, similarity **0.832977**.
- 50: **27.580-31.248**, distance **0.179232**, similarity **0.820768**.
- 75: **27.426-31.240**, distance **0.173804**, similarity **0.826196**.
- 80: **27.621-31.308**, distance **0.179299**, similarity **0.820701**.
- 100: **27.621-31.238**, distance **0.191305**, similarity **0.808695**.

Candidate boundaries are the generic detector's observations, not hard-coded physical-attempt timestamps. Full per-reference boundaries, rejected scores and feature diagnostics are preserved in `learner-stream-validation.json` and every raw `learner-stream-{difficulty}.json`. Missing completed-boundary evaluations in a cropped window are reported as incomplete candidate detection, not an invented score or repetition.

Independent diagnostic windows front1 9-14 s, front2 14-18 s, side1 23-28 s and side2 28-33 s give **0/0/0/1 accepted attempts at all five difficulties**. Their best whole-window distance vectors, difficulty order 20/50/75/80/100:

- Front1: **0.440905/0.449162/0.448029/0.448566/0.447536**.
- Front2: **0.431611/0.432884/0.434767/0.549990/0.434846**.
- Side1: **0.257413/0.284517/0.268491/0.265499/0.283336**.
- Side2: **0.185490/0.180715/0.184122/0.180777/0.192338**.

These standalone whole-window scores are diagnostic, not identical to bounded natural candidate scores. Similarity is 1-distance. Every window reaches 100% causal guidance here, yet only side2 is accepted. At 75, side1's natural candidate 23.014-27.360 s is rejected at **0.268491**. Front1 has a rejected T4 candidate 9.063-12.664 s at **0.628611**; front2 has no completed candidate in its cropped replay. Cropping may omit start/end context; full continuous traces remain primary.

Why positive attempts fail: at 75 the best aligned front1 reference is T1, with mean left-forearm direction error **43.47 degrees**, left upper arm **41.29**, left shoulder bend **32.01**, right forearm **29.98**, left elbow bend **29.32**. Worst teacher-stage support is **0.448029** (~80.65 degrees), beyond 45 degrees, despite low aggregate mean pose error **0.094308**. Front2 against T1 has left upper arm **46.97 degrees**, left forearm **44.95**, shoulder **37.23**, elbow **34.70**; stage support **0.434767** (~78.26 degrees), mean pose error **0.104340**. Side1 against T5 has mean forearm **42.24 degrees** and elbow **25.85**, but unsupported stage **0.268491** (~48.33 degrees). Side2 against T5 has mean forearm **28.11 degrees**, left thigh **18.03**, upper arm **14.85**, with stage support **0.184122** (~33.14 degrees). The coverage guard prevents an aggregate mean from hiding the wrong or unsupported limb configuration. These measurements were not used to tune anything.

Setup/walking, between-attempt turn/standing and exit produce **zero full repetitions at every difficulty**, both separate windows and full recording (the one success lies in side2). Setup maximum guidance is 0%; turn is 0/2.5/2.5/2.5/2.5%; exit is 2.5/2.5/12.5/2.5/17.5%. Partial guidance during negative movement is not concealed. Teacher static/partial controls and synthetic opposite-direction, disconnected, endpoints-only and reversed-sequence controls reject. Two successive correct cycles produce two events; a short missing observation is ignored, long tracking gap resets, and explicit endpoint dwell is tested independently of generated zero holds.

**Does the simple articulated matcher recognize independently performed executions? Yes, narrowly:** T2/T3 recognize each other, and one independently recorded learner attempt matches T5 at all requested difficulties, including 100 on roughly 15-FPS input. It does **not** reliably recognize all comparable-looking attempts or establish viewpoint invariance. Front/side labels are reporting only; side1 fails and side2 passes, while both front attempts fail. This is limited recognition evidence, not validation of arbitrary movement accuracy, real-hardware webcam accuracy or learner dance.

### Performance Measurements

Fresh production teacher GPU inference: **32.470 ms mean / 37.300 ms p95**, 994 observations in **53.519 s** including seeks; descriptor **0.05151 ms mean**. Dance inference **31.755 / 36.800 ms**, 153 observations in **7.819 s**, descriptor **0.05359 ms mean**. The same bundled model's section-24 CPU probe remains **164.177 / 180.100 ms**, about 6 inference FPS: CPU works but is not claimed to sustain 15 FPS. No new model/infrastructure was introduced.

Offline current-descriptor construction over 994 real world poses: **0.03598 ms mean / 0.04480 ms p95**. Production tracker at difficulty100: one reference **0.31273 ms mean / 0.19450 ms p95**; all five references **0.55165 / 0.74530 ms**. Timings include occasional completed-candidate scoring; outliers can make mean exceed p95. Natural accepted candidate scoring across the five fresh learner runs: **1.434/1.208/1.338/1.948/11.535 ms**. Storage and DP remain bounded; sequence scoring runs on completion, not every frame or a multi-minute recording. These are local Windows/Chromium measurements, not hardware-independent guarantees.

### Fresh Production Compilation and Upload Lifecycle

A separate fresh browser production compile (not the frozen diagnostic source cache) produces **8 uploaded teacher proposals / 5 eligible references**, retained knots **16/12/13/39/13**. Proposal boundaries and inferred model poses vary slightly from earlier extraction; no source count is forced. All five fresh references pass exactly one self repetition at every requested difficulty before the learner matrix runs. Dance produces one sequence reference with **66 observed knots**, self-completing once at all five levels. New identifier, observed coherent geometry, start/completion-only anchors and no apex are asserted.

With that independently re-extracted teacher lesson, the full learner matrix again gives **1/1/1/1/1 repetitions**, 100% maximum causal guidance, **543/543/535/532/518 delivered** and **540/534/530/527/513 usable** observations. Each run calibrates from actual poses, rewinds to zero, ends automatically and emits exactly one evaluation. This is a separate product regression, not substituted for the original frozen empirical matrix.

Actual UI upload test passes with getUserMedia replaced by a throwing counter: **zero camera calls**. Calibration/start/final-evaluation share one stable ID; EOF needs no Finish click and yields exactly one evaluation. Final video elements are unmounted; none keeps playing. Skeleton canvas has **49,944 non-transparent pixels**, bounded render width, and visually inspected desktop/mobile screenshots show both learner and actual teacher ghost without incoherent overlap. New frozen learner browser tests additionally assert **zero /api/movement requests**, correct representation on observations and unchanged frozen teacher bytes. Uploaded and webcam observations enter the same LearningRun/ArticulatedProgressTracker path.

Software validation so far: **174/174 unit tests in 34 files**, including **21 articulated tests** and **23 prior Heavy/OAS compatibility tests**; typechecks/lint/build pass (three existing Fast Refresh warnings and existing bundle warnings). Python compatibility/offline regressions: **82/82**. Frozen actual streaming test: **1 passed**. Default movement product suite: **2 passed, 5 explicitly opt-in diagnostic probes skipped**. A sandbox esbuild startup error is preserved in `verify-final.log`; approved rerun in `verify-approved.log` passes. General browser and full Level-B outcomes follow below; these are not assumed passing from unit totals.

### Final Product Regressions

Full Level-B suite: **8 passed, 0 failed**. Real upload semantic coverage remains 16/16, with five demonstrated alignments, no invented transcript/guardrails, six capture/four debrief questions and simulated answers explicitly flagged. Actual upload Teach analysis takes **71.829 s**, saves a Work Map with **24 knowledge items / 2 guardrails**, and reloads the complete persisted contract. Evidence replay seeks correctly. This validates the semantic/persistence pipeline, not automatic movement-class recognition.

Chromium fake-camera Teach records **50 pose observations / 6.407 seconds**, downloadable video **1,267,036 bytes**, with actual pose calibration. Live Learn against the newly saved articulated lesson shows match values **90/96/97/99**, checkpoints **0/1/3**, **20 guidance checkpoint events**, naturally accepted reps and geometric coaching. The observed UI sample is 51 frames/one rep; final mastery records two reps after subsequent frames. Cleanup checks pass: camera acquired/released **2/2**, pose loop started/stopped **3/3**, microphone released, clean subsequent Teach setup. The fake camera is prerecorded media, not validation on a physical webcam/person. Voice test opens two real configured sessions and closes sockets/microphone tracks; a historical section-24 failure is retained and not claimed fixed by unrelated matcher changes.

Full general Chromium regression suite: **11 passed, 0 failed**, including camera/microphone denial, voice failure, invalid upload, transcription failure/no invented narration, damaged persisted lesson rejection, home/config/debug, legacy fixture Teach/Learn/persistence and camera/log layout. Combined current final browser suites: **22 passed** (11 general + 8 Level-B + 2 default movement + 1 explicit frozen stream), **0 failures**, with **5 opt-in probes skipped** in the default movement run. Software assertions do not require the four physical learner attempts to pass. Final JS units are 174 and Python compatibility tests 82; do not add teacher replay checks to those test-runner totals.

The optional Heavy CPU/probe test now explicitly expects the new articulated default and writes into `articulated-v1/model-probe/`, so rerunning it cannot overwrite section-24 OAS evidence. It was not rerun as part of the default suite; the previously measured same-model CPU inference result is labelled historical above. All source changes pass typechecking. No remaining test command is left running.

### Remaining Limitations and Decision

- **Critical:** none demonstrated in the implemented shared Teach/Learn lifecycle or current regression suites. This is not a general accuracy certification.
- **High:** only **one of four** independent learner attempts is recognized, and only **two of twenty** non-identity teacher pairings match. Unsupported arm/forearm configurations dominate the recorded failures; the fixed coverage guard deliberately does not hide them behind a low aggregate mean. Recognition is limited, not solved by software passing.
- **Medium:** model-estimated world directions/body-frame validity can vary with visibility and viewpoint; ideal rigid invariance does not establish real-camera invariance. Optional segmentation can yield heterogeneous episodes (T4 start/terminal worst error **0.275286**, above 0.25) requiring teacher review, independent of matcher correctness. Single-execution Teach avoids that dependency. CPU inference is functional but below 15 FPS here; synchronous browser inference may block UI. <=100-sample geometric compaction can discard fine detail; 60-second candidate bound limits long sequences. No learner dance, independent-camera/session teacher dataset or real-hardware webcam accuracy study exists.
- **Low:** generic phase display currently says "sequence" for the new unlabelled trajectory even when the lesson is a cycle; repetition/sequence events remain correctly distinct. Existing lint/bundle warnings remain. Container execution and deployment were not validated/published in this task. Historical failures, diagnostic caches and unrelated dirty worktree files remain preserved.

**Decision: simple articulated 3D movement matching is implemented end-to-end and has limited independent-execution recognition evidence.** Self replay, speed/sample-density robustness, bounded scoring, negative controls and product lifecycle pass. The unchanged learner fixture yields one natural repetition at all requested difficulties, with the other three failures preserved and explained. No model replacement, threshold tuning, covariance, semantic/action/view gate or learner-derived teacher calibration was added to make the results appear better.

## 26. Final MVP Fixture Validation

### Frozen Architecture and Evidence

Section 25 remains authoritative: **mediapipe-articulated-3d-v1**, MediaPipe Heavy VIDEO, coherent independent teacher references, causal local guidance and bounded completed-candidate scoring. Fixed tolerance **0.25**, descriptor, normalization, sampling and acceptance are unchanged. This task changes validation tests/scripts and documentation only; it does not change production behavior.

All three fixture bytes were reconfirmed. Fresh actual UI upload/Teach/save/reload tests generated both final lessons, not cached RTMW3D/OAS references. Teacher answers and review confirmations were **simulated test actions**, not independent human endorsement of every segmentation proposal. Raw evidence lives in [final-mvp](../test-results/movement/final-mvp/), including teacher records, every learner pose/trace, candidate scores/rejection reasons, screenshots and suite logs. Earlier evidence copied into `final-mvp/prior-evidence/` remains available; sections 1-25 are unchanged.

The whole fresh squat lesson and eight matcher/config file hashes were frozen **before** learner inference: SHA256 **e2d3c320f72fc6e97fcaedb1d78ee5ba0d35e831574bbfc85dfae0e2db0bc7ad**. Every difficulty and the final audit confirm identical bytes. No learner-derived tuning occurred. Fresh extraction produces six eligible sources rather than the historical five; that is a teacher-only proposal/inference outcome, not a parameter change.

### Squat Teacher

`data/lesson-squat.mp4` loads and yields **994/994 valid observations**, monotonic timestamps and finite descriptors. Eight proposals produce **six accepted eligible references / two ineligible fragments**. R1-R6, in source order: **7.933-10.400 / 12.867-15.667 / 18.200-20.733 / 30.200-38.867 / 57.267-58.667 / 59.733-62.133 seconds**, with **18/12/14/42/6/13** retained actual knots. Every sampled body belongs to its own observed source; no coordinate averaging, mandatory apex, generated hold/dwell or OAS is used. Camera and Python/RTMW movement requests: **zero**. Local/remote persistence and reload preserve exact canonical geometry, schema and `kind=cycle`.

Self replay: **6/6 exactly one REP_SUCCESS at each of 20/50/75/80/100**, **30/30** checks. At 75, normal, endpoint-preserving half density, doubled density (repeated observed poses) and small internal drops each pass **6/6**, **24/24** temporal checks. Static and partial sources each produce **0/6 repetitions**. Natural teacher cross-reference replay passes **3/30 non-identity pairings**; the full matrix and distances remain in [teacher-validation.json](../test-results/movement/final-mvp/teacher-validation.json). This is limited generalization, not universal teacher interchangeability.

### Dance Teacher

`data/lesson-dance.mp4` yields **153/153 valid observations**, one coherent sequence with **69 actual knots**, and exact local/remote save/reload as `kind=sequence`. No apex, cycle-return phase, generated dwell, OAS or RTMW3D request occurs. At every requested difficulty: **exactly one SEQUENCE_COMPLETE and zero REP_SUCCESS**. Reversed replay: **zero completions**. Concatenated double replay: **one completion**, no wrap. No learner dance fixture or learner dance accuracy is claimed.

### Frozen Real Squat Learner

Five fresh production `LearnerVideo -> Heavy VIDEO -> LearningRun -> ArticulatedProgressTracker` runs use that same persisted squat lesson. Difficulty order throughout: **20/50/75/80/100**. Delivered poses: **518/534/524/536/534**; usable: **510/528/520/530/529**. Maximum causal guidance: **100% at every level**, not equivalent to accepted ordered coverage. Completed per-reference candidates: **9/9/10/9/8**; rejected: **7/7/8/7/7**; accepted repetitions: **2/2/2/2/1**. Each run has **one EOF evaluation, zero camera calls and zero Python/RTMW requests**. End-to-end wall times: **52.752/44.133/44.475/43.708/43.621 seconds** for 36.436-second, approximately 15-FPS media.

Actual continuous accepted boundaries (seconds), final distances and similarities:

- **20:** R5 **21.642-26.376**, distance **0.143874**, similarity **0.856126**; R5 **28.508-31.174**, **0.137491 / 0.862509**.
- **50:** R5 **21.744-26.362**, **0.139559 / 0.860441**; R5 **27.777-31.205**, **0.139793 / 0.860207**.
- **75:** R5 **21.678-26.495**, **0.152131 / 0.847869**; R5 **28.577-31.191**, **0.155041 / 0.844959**.
- **80:** R5 **21.682-26.418**, **0.148877 / 0.851123**; R5 **28.532-31.159**, **0.147291 / 0.852709**.
- **100:** R6 **27.538-31.207**, **0.194848 / 0.805152**.

R5 is `fb412fe5-e57f-41be-b94f-dc4f88b12be7`; R6 is `a1f2d38d-8979-4ab2-96f9-a22cc3a92ce1`. All completed rejected candidates exceed the unchanged teacher-stage support tolerance; some also exceed the per-feature mean tolerance. Exact reference IDs, boundaries, scores, similarities and explicit reasons for **every rejected candidate at every difficulty** are preserved in [learner-stream-validation.json](../test-results/movement/final-mvp/learner-stream-validation.json), alongside original production summaries in `learner-stream-{difficulty}.json`. Candidate counts are not physical-attempt counts. Rejected settling/exit candidates remain visible; no score or successful repetition is fabricated.

### Four Physical Attempts

View/attempt labels and diagnostic crop boundaries exist only in reporting, not production. At **75**, every crop reaches 100% causal guidance, but acceptance is separate:

- **Front attempt 1:** not accepted. Best whole-window diagnostic reference R1, distance **0.435898**, similarity **0.564102**. No completed candidate in the cropped natural replay, so completed distance is **N/A**. Largest aligned mean differences: left upper arm **41.68 degrees**, forearm **41.52**, shoulder bend **32.43**, elbow bend **30.09**.
- **Front attempt 2:** not accepted. Best diagnostic R1, **0.432095 / 0.567905**; cropped completed distance **N/A**. Left upper arm **47.14 degrees**, forearm **44.65**, shoulder bend **37.99**, elbow bend **34.76**.
- **Side attempt 1:** accepted by R5. Cropped natural completed candidate **23.011-26.495 seconds**, **0.168988 / 0.831012**. Best whole-window R5 diagnostic **0.163071 / 0.836929**. Continuous score differs because preceding compatible standing observations belong to its detected candidate.
- **Side attempt 2:** accepted by R5. Cropped natural candidate **28.043-31.191 seconds**, **0.155041 / 0.844959**. Best whole-window diagnostic is **R6**, **0.173784 / 0.826216**; this is not the production winning reference or production acceptance score.

Both front attempts fail at all five levels; side1 passes **20/50/75/80**, fails **100**; side2 passes all five. At 100, side1's completed R5/R6 candidates reject at **0.323410 / 0.274939** despite a lower standalone whole-window diagnostic score. Diagnostic crops/full-source scoring are not interchangeable with runtime density and naturally detected boundaries. At 75 the rejected continuous R1 candidate spans both front attempts (**6.194-16.728 seconds**, distance **0.411421**); it is not assigned as an individual attempt's completed score. Front discrepancies and sparse teacher cross-recognition remain recorded, without tolerance adjustment.

### Negative Controls

Setup/walking, between-attempt turn/standing and exit each yield **zero REP_SUCCESS at all five difficulties**, both standalone replay and continuous completion-event annotations. Setup guidance is 0%; turn is 2.5% at 20-80 and 0% at 100; exit is 2.5%. Partial guidance is not concealed or counted as success. Static, incomplete/partial, disconnected, opposite-direction and reversed-sequence synthetic negatives remain unchanged and pass the registered regression tests.

### Product and Fake-Camera Lifecycle

The actual UI uses the **same freshly saved squat lesson** for uploaded learner calibration from observed poses, rewind to **zero**, evaluation to EOF and automatic results without Finish. Stable run ID, **one final evaluation**, no duplicate EOF repetition, **zero getUserMedia / movement requests**, and no media left playing are asserted. Default-75 UI playback produces two repetitions and **13 coaching corrections**. Pixel evidence shows **9,325 teacher-ghost / 36,415 learner-skeleton pixels**; desktop/mobile screenshots preserve the rendered ghost, skeleton and articulated directional coaching. Both fresh teacher lessons persist/reload with exact canonical geometry and correct kind.

Full Level-B prerecorded fake-camera regression passes: Teach records **53 poses / 7.411 seconds**, live Learn shows varying **92/93/95/98%** guidance, a natural repetition and geometric coaching. Camera acquisition/release **2/2**, pose start/stop **3/3**, microphone/socket closure and clean subsequent Teach calibration pass. The saved lesson uses **mediapipe-articulated-3d-v1** and the live detector/matcher share the upload core. This is lifecycle evidence on prerecorded fake media, **not real-human webcam accuracy**.

### Performance, Regressions and Cleanup

Fresh local GPU Heavy inference: squat **34.379 ms mean / 38.800 ms p95**, dance **37.740 / 45.400 ms**. Descriptor means **0.06187 / 0.05425 ms**. Extraction including seeks/initialization: **61.090 / 15.906 seconds**. Production tracker benchmark with all **six** references at 100: **0.690 ms mean / 0.804 ms p95**, negligible relative to inference; completed-candidate DP remains bounded, not accumulated-history online DTW. These are local timings, not hardware-independent performance guarantees.

Software: `npm run verify` passes **174 unit tests / 34 files**, both typechecks, lint and production build; three existing Fast Refresh warnings and existing bundling warnings remain. Python movement compatibility/offline suite: **82 passed**. General Chromium: **11 passed**; Level-B: **8 passed**; default movement: **2 passed / 7 explicitly opt-in probes skipped**; explicit fresh teacher UI: **2 passed**; explicit frozen learner matrix plus same-lesson UI: **2 passed**. All listed final runs have **zero failures**. Browser totals are **25 passed executions**, not 25 distinct tests: upload lifecycle runs in both default and explicit validation. The default movement suite's older five-source product fixture is separate regression evidence, not a replacement for the frozen six-source final empirical matrix. Empirical teacher replay/robustness checks and standalone diagnostic scripts are **not** added to software test totals.

Audit confirms articulated is the new-lesson default; Heavy/OAS and RTMW3D require explicit old-lesson compatibility selection. Historical `DTWProgressTracker` has no production caller; Python online-DTW callers are offline diagnostics/tests. Current `CompletedMovementScorer` bounded completed-candidate DTW remains untouched. Searches find no fixture/action/view matching behavior in active production code or polluting temporary logging. No historical evidence, old-lesson compatibility or useful tests were deleted. Validation changes are `final-teaching.spec.ts`, `articulated-learner.spec.ts`, `upload-lifecycle.spec.ts`, `validateArticulatedTeacher.ts`, `evaluateArticulatedLearner.ts` and this appended section.

### Remaining Limitations and Final Status

Recognition is limited: both front attempts fail, side1 fails at 100, and only 3/30 non-identity teacher pairings complete. Occlusion/viewpoint-dependent estimated geometry, inference cadence and teacher-reviewed segmentation remain meaningful limitations, including the long heterogeneous R4 and short R5 proposal. This single recording does not certify universal motion recognition. No learner dance, real-human webcam accuracy or independent-device/session accuracy validation exists. Historical CPU measurements do not establish 15-FPS CPU operation; generic cycle phase display and existing build/lint warnings remain. No new representation/model, thresholds, infrastructure, deployment or recognition optimization was introduced.

**FINAL MVP VALIDATION PASSED WITH KNOWN RECOGNITION LIMITATIONS.** Both fresh teacher lessons work through the current UI and persistence path; self replay, temporal robustness, sequence no-wrap, uploaded learner lifecycle and software regressions pass. Independently performed learner recognition is genuine but partial, with no false repetitions in the annotated negative regions. Frozen lesson/constants and sections 1-25 remain unchanged. Validation is complete; no further recognition tuning or architecture investigation is part of this task.

## Historical Closeout: Final MVP Release Validation (Before 20 Targets)

Closeout date: **2026-10-05**. This is a separate fresh product validation, not a replacement for Section 26. Sections 1-26 and `test-results/movement/final-mvp` are preserved. Raw evidence, suite logs, failed traces and full pose/candidate records live in [release-mvp](../test-results/movement/release-mvp/). Expert answers/review are simulated test actions; fixture decoding, MediaPipe inference, UI, persistence and matching are real. **Software correctness and movement-recognition accuracy are reported separately.** No learner-derived tuning or architecture experiment was performed.

### 1. Frozen Architecture

The authoritative new path remains **MediaPipe Heavy VIDEO -> body-relative articulated 3D -> signed unit bone directions + joint bends -> coherent independent observed teacher references -> causal local guidance -> bounded completed-candidate scoring -> REP_SUCCESS / SEQUENCE_COMPLETE**. Identifier: `mediapipe-articulated-3d-v1`; tolerance **0.25**, descriptor confidence **0.3**. Model, descriptor, body frame, matching, reference construction, completion rules and explicit holds are unchanged. Difficulty changes density only; runtime target counts at **1/20/50/75/80/99/100: 3/3/3/5/6/101/101** for the fresh lesson.

Actual Teach call graph: `TeachFlow -> VideoPoseExtractor / LivePose -> MediaPipePoseDetector -> articulatedBody -> ArticulatedTeaching -> ArticulatedReferenceBuilder -> LessonCompiler -> LessonSchema -> LessonRepository`. A single live execution bypasses long-recording segmentation. Optional upload proposals still use the existing generic recurrence/PCA/hysteresis helper, including its transient `heavyBody` feature adapter, then map back to original articulated observations. This contained proposal helper is not OAS calibration, a persisted section-24 reference or the new matching representation; its reuse is explicitly disclosed rather than claiming no historical feature helper executes anywhere during Teach.

Actual Learn call graph: `LearnerVideo / LivePose -> same MediaPipePoseDetector + descriptor -> LearningRun -> ArticulatedProgressTracker -> CompletedMovementScorer -> event/results`. No active new-path RTMW3D/Python movement request, OAS fit, coordinate-median body, cross-reference phase borrowing, mandatory apex, generated 150-ms hold, semantic anchor region, action/view classifier or full-history online DTW exists. The bounded completed-candidate alignment is intentionally retained. `DTWProgressTracker` has no production caller. Source searches found no fixture filenames, known attempt timestamps, expected count/winner or front/side matching branches in the active matching path; fixture-aware diagnostics stay in tests/scripts.

Before learner inference, the **whole fresh teacher lesson plus eight matcher/config hashes** were frozen at **2026-10-05T18:27:34.239Z**, SHA256 **ce3009fe3bd58d7688bed164d99bb19a85d9ea67fb9a7a42ab6064e281c25047**. Every primary learner run and final audit confirm unchanged bytes/files. See [freeze.json](../test-results/movement/release-mvp/freeze.json) and [frozen-teacher.json](../test-results/movement/release-mvp/frozen-teacher.json). UI/retry/coaching-copy fixes do not modify this matching kernel.

### 2. Teach Validation

Fresh squat upload: **994/994 valid observations**, eight proposals, **five eligible independent references**, one included but ineligible record (excursion **0.101980**, below fixed **0.125** eligibility requirement), two excluded fragments. The five eligible sources retain **16/12/15/41/11 actual knots**. This differs from Section 26's six eligible sources because inference/proposal geometry differs; no count was forced. Long/heterogeneous proposals remain reviewable, not automatically certified teacher technique.

Fresh dance upload: **153/153 valid observations**, one sequence, **68 actual knots**. Both fresh lessons pass actual analysis/review/save, exact local and remote canonical reload, schema/kind checks; uploads make zero camera and movement-service requests. [teacher-cycle.json](../test-results/movement/release-mvp/teacher-cycle.json) and [teacher-sequence.json](../test-results/movement/release-mvp/teacher-sequence.json) retain extraction, proposal and persistence evidence.

Review now permits replay/include/exclude, clearly distinguishes fragments/ineligible sources, blocks saving with no included usable execution, guards duplicate submission and provides usable re-record/choose-another-recording actions. Rejected proposals do not persist as matching references; provenance-only ineligible records remain explicitly ineligible. Retry clears stale analysis/interview/draft state. Failed model analysis returns to recording review instead of remaining in a working state. The controlled live Teach test saves **35 observed poses / 12 knots / one eligible reference** without multi-repetition segmentation. No manual teacher endorsement or six-squat requirement is implied.

### 3. Cycle Validation

Each of the five eligible fresh teacher sources produces **exactly one REP_SUCCESS at 20/50/75/80/100: 25/25 checks**. Normal, endpoint-preserving half density, doubled observed samples and small internal drops each pass five sources: **20/20 temporal checks**. Static/partial controls produce zero repetitions. Full teacher-reference matrix at 75, rows replayed source and columns reference, in eligible source order:

```text
1 0 0 0 0
0 1 1 0 0
0 1 1 0 0
0 0 0 1 0
0 0 0 0 1
```

Non-identity recognition is **2/20**, not universal teacher interchangeability. R1-R5: `57b4ae39`, `0f115b56`, `ef06337e`, `955c7689`, `e6052d7f` (full IDs/distances in [teacher-validation.json](../test-results/movement/release-mvp/teacher-validation.json)). Completed rejection resets without phase/reference borrowing. The actual newly saved live lesson naturally produces **one REP_SUCCESS**, distance **0.088169**, similarity **0.911831**, with **42/42 usable live observations**; no pose/event injection is used. This is prerecorded video-backed camera evidence, not real-human webcam accuracy.

### 4. Sequence Validation

Exact recorded dance source replay produces **one SEQUENCE_COMPLETE / zero REP_SUCCESS at every requested difficulty**. Reverse produces zero completions; concatenated double replay produces one completion, no wrap. Source construction has no fabricated apex/return/dwell. Exact-source sequence semantics pass, but this must not be conflated with fresh-inference UI recognition.

**Required actual dance upload UI self-replay fails.** Preserved runs reach EOF/results with zero sequence events. One fresh run reached 100% guidance and naturally scored a completed candidate **0.018374-10.007033 seconds**: distance **0.250685909**, similarity **0.749314091**, rejected at unchanged tolerance due to unsupported teacher stage **49**; mean pose distance **0.020743196**, largest mean feature left forearm **0.044699202**. An offline check of the additional final decoded frame, using the same detector and production tracker, still produced no sequence event. Earlier source geometry was nearer than terminal geometry; omitting one last frame alone did not explain that failed run. The temporary probe was removed from tests; no production EOF inference or tolerance change was made. See [dance-ui-terminal-probe.json](../test-results/movement/release-mvp/dance-ui-terminal-probe.json) and [dance-terminal-diagnostic.json](../test-results/movement/release-mvp/dance-terminal-diagnostic.json).

The final full-suite replay also fails: **90/90 usable observations, 15% maximum guidance, two tracking-gap restarts, zero completed candidates, one final EOF evaluation**, zero camera/movement/CDN model requests, results latency **2371.7 ms**. See [dance-ui.json](../test-results/movement/release-mvp/dance-ui.json) and the full-suite failure trace. Geometry/terminal ambiguity and cadence sensitivity are observed; an ordinary matcher bug is not established, and no architecture-changing fix was attempted. The required reliable sequence UI demo gate remains unresolved.

### 5. Independent Learner Validation

Primary fresh actual learner inference uses the frozen lesson. Difficulty order **20/50/75/80/100** throughout: delivered **491/538/531/519/508**, usable **485/536/524/515/499**, maximum guidance **100% each**, completed per-reference candidates **5/6/7/6/4**, rejected **3/4/5/4/3**, repetitions **2/2/2/2/1**. Wall times **50.000/43.857/47.539/43.785/43.712 seconds** for 36.436-second approximately 15-FPS media. Each has one EOF and one final evaluation, zero camera calls and zero Python/RTMW requests. No progress/EOF acceptance is fabricated.

All accepted candidates use R5 (`e6052d7f-436e-4759-895b-1df68ddcbcbf`). Continuous accepted boundaries in seconds and final distance/similarity:

- **20:** 22.277878-27.462301 **0.239877/0.760123**; 27.534686-31.611807 **0.169522/0.830478**.
- **50:** 22.386663-27.486477 **0.237932/0.762068**; 27.571326-31.470246 **0.164813/0.835187**.
- **75:** 22.393169-27.508739 **0.239603/0.760397**; 27.607050-31.555487 **0.168943/0.831057**.
- **80:** 22.219630-27.635593 **0.238003/0.761997**; 27.741467-31.617259 **0.175163/0.824837**.
- **100:** 27.484178-31.533004 **0.172241/0.827759**.

[learner-stream-validation.json](../test-results/movement/release-mvp/learner-stream-validation.json) preserves **every** completed candidate, boundary, winning/reference ID, distance, similarity, acceptance and rejection reason, physical-window diagnostics and bone/bend errors; original pose/event streams remain in `learner-stream-{difficulty}.json`. Rejections exceed fixed teacher-stage support, sometimes per-feature mean support. One insufficient-geometry infinite distance serializes as null: it is N/A, not a fabricated finite similarity.

Diagnostic windows do not enter production. At 75: **front1** completes an R4 candidate 9.009228-12.558604 and rejects **0.625911/0.374089**, maximum guidance 100%; best whole-window R1 **0.443186/0.556814**; largest mean errors left forearm **42.69 degrees**, upper arm **40.56**, shoulder **31.44**, right forearm **31.02**. **Front2** has no completed candidate (N/A), maximum 52.5%; best R1 **0.434075/0.565925**; left upper arm **46.72 degrees**, forearm **46.19**, shoulder **36.92**, elbow **34.51**. **Side1** completes R5 23.658663-27.508739 and accepts **0.240898/0.759102**, maximum 100%; standalone R5 **0.266732**; left forearm **43.72 degrees**, elbow **24.49**, shin **10.62**, thigh **10.23**. **Side2** completes R5 28.054359-31.555487 and accepts **0.168943/0.831057**, maximum 100%; standalone R5 **0.183217**; left forearm **28.54 degrees**, thigh **17.46**, upper arm **14.57**, shin **11.69**. Standalone window scores are not production candidate scores. Front1/front2 fail all five; side1 passes 20-80, rejects at 100 (**0.308250**); side2 passes all five. These results are not tuned.

A **separate freshly compiled regression teacher**, not this frozen lesson, yields **1/1/1/1/1** in the final regular matrix (delivered **538/525/535/528/523**). Its subsequent UI lifecycle replay yields two repetitions. Cadence/reference variability is preserved in [regression-final](../test-results/movement/release-mvp/regression-final/), and the prior regression evidence is retained separately. This worse matrix is neither hidden nor substituted for the primary frozen comparison.

### 6. Negative Controls

Setup/walking, turn/standing and exit produce **zero REP_SUCCESS at all five difficulties**, in standalone replay and continuous completion-event windows. Guidance can be nonzero: setup **2.5/0/0/0/0%**, turn **5% each**, exit **2.5/0/0/2.5/12.5%**. Partial guidance is not success. Fresh teacher static/partial controls each reject all five; registered synthetic tests cover disconnected movement, endpoints only, opposite direction, asymmetric reversal, missing observations/tracking gaps and sequence reverse/no-wrap. No systematic false completion is observed in these tested negatives.

### 7. UI/Lifecycle Validation

Passing actual workflows: live Teach/save -> same saved lesson live Learn/natural REP/results; fresh squat and dance Teach uploads/review/save; fresh saved squat Learn upload/calibration/rewind/automatic EOF results; reload, proposal rejection, all-unchecked save prevention, retry/back/Home, failed analysis recovery, camera/microphone denial, voice/transcription failure, invalid media and corrupt saved lessons. Desktop/mobile screenshots show coherent visible ghost/learner/coaching without overlap. Primary fresh-lesson upload UI produces two repetitions, 13 corrections and visible pixels **9348 teacher / 36371 learner**. The final separate regression UI also passes with two repetitions; EOF/results latency **67 ms**. The dance completion workflow is the explicit failing accuracy assertion, not a claimed success because EOF/results work.

Cycle phase display uses Cycle rather than misleading Sequence; articulated fallback coaching now says "Match the teacher's movement shape." Legacy wording is unchanged. Success-overlay timers clear on replacement/unmount. Live closeout camera acquisition/release **2/2**, pose-loop start/stop **4/4**; Level-B camera **2/2**, pose loops **3/3**, voice sockets/microphone cleanup and clean next Teach pass. Stable run IDs, upload rewind to zero, exactly one final EOF evaluation, zero upload getUserMedia, no duplicate repetition/result and stopped media are verified. Existing disposal covers pose detectors, listeners, waits/aborts, animation frames, object URLs and voice sessions. Invalid long fake-camera captures were retained as failures rather than weakening tracking-gap rules; the final harness captures one real decoded execution through MediaPipe.

### 8. Persistence/Compatibility

Fresh cycle and sequence save/reload preserve exact canonical representation/kind, independent observed sources/knots, confidence masks, start/terminal data and explicit holds. Three persisted compatibility fixtures pass explicit unchanged-geometry routes: legacy 2D `ProgressTracker`, RTMW3D `LocalProgressTracker`, section-24 Heavy/OAS `HeavyProgressTracker`. Malformed mixed representations and corrupt saved lessons reject explicitly. No old geometry is silently migrated and no fresh RTMW3D accuracy claim is made.

Heavy model/WASM are served locally from bundled configured assets; verified model SHA256 **64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b**, provenance/license in `public/models/MEDIAPIPE_NOTICE.md`. New pose inference stays browser-local with no hidden model CDN or Python movement dependency; CPU probe confirms no external model requests. Teacher narration can still use configured backend/voice/transcription services, so this is not a blanket all-media-on-device claim. No credentials, pose-leaking debug endpoint or new infrastructure was introduced. Compatibility implementations and historical evidence are retained.

### 9. Performance

Measured GPU Heavy mean/p95: squat **39.313/49.300 ms**, dance **38.230/52.100 ms**. Descriptor mean/p95 **0.0638/0.200 ms** and **0.0712/0.200 ms**. Fresh CPU probe **32/32 descriptors**, inference **218.566/266.600 ms**, descriptor **0.291/1.100 ms**; initial CPU probe **228.972/263.800 ms**, descriptor **0.0813/0.200 ms**, retained separately. CPU is functional but approximately 4-5 FPS here, not demonstrated 15-FPS operation.

Production tracker offline Node benchmark at 100: one reference **0.320/0.150 ms mean/p95**, all actual five **0.617/1.076 ms**. JIT/outliers can put mean above p95; measurements are preserved, not smoothed. Descriptor/live tracker remain small relative to inference. Browser completed-candidate scorer: **28 candidates, mean 8.314 ms / p95 21.5 ms**; accepted-candidate timings range **1.3-20.6 ms**. Candidate scoring is bounded and occasional, not per-frame accumulated-history DP; its instantaneous cost is not claimed negligible.

Teacher extraction **73.564/16.455 seconds**; complete upload-analysis/review flow **87.358/25.495 seconds**. Primary learner end-to-end **43.712-50.000 seconds**; cycle EOF/result **67 ms**, failed dance probe **72.6 ms**, final cadence-degraded dance **2371.7 ms**. These are local measured results, not hardware-independent guarantees. No worker/server/model/threshold optimization was added speculatively.

### 10. Software Test Results

Final `npm run verify`: **178 unit tests / 34 files passed**, frontend/backend typechecks pass, lint zero errors (three existing Fast Refresh warnings), production build passes (existing static/dynamic import and large-chunk warnings). Python compatibility/offline **82 passed**. General Chromium **11 passed**; Level-B **8 passed**; explicit fresh teacher UI **2 passed**; explicit frozen learner matrix plus fresh-lesson upload UI **2 passed**. Release-enabled full movement suite: **9 passed / 1 failed / 7 explicitly opt-in skipped**. Failure: actual saved dance upload self-replay expects `sequenceComplete: true`, receives false at EOF. The assertion is retained, not skipped or weakened.

Across these final browser commands: **32 passed / 1 failed executions**, seven opt-in skips; overlapping lifecycle runs are executions, not unique-test counts. Teacher numerical self/temporal checks and diagnostic scripts are not added to software totals. Earlier failed harness/selector and dance experiments remain raw evidence, not silently reclassified as final successes. `git diff --check` passes. README documents current architecture, local assets, run/test commands, compatibility and this unresolved gate; no deployment or commit/push was performed.

### 11. Known Limitations

- **Critical:** none demonstrated (no corrupt persistence, leaked secret or systematic tested-negative false acceptance).
- **High:** required actual dance UI sequence-completion gate remains failing across fresh inference; one run rejects a geometrically unsupported stage just above 0.25, final suite additionally loses candidate continuity under inference cadence. Exact recorded-source sequence events pass, so sequence semantics are not declared universally broken. Geometry limitation category **F** is supported for the scored failed run; cadence sensitivity remains an unresolved runtime coverage limitation, not proven A-E root cause. No architectural remedy or tolerance adjustment is justified by this closeout.
- **Medium:** limited cross-demonstration/generalization (2/20); both front attempts reject; first side attempt rejects at 100; separate fresh regression matrix drops to 1/1/1/1/1. MediaPipe single-person inferred depth, visibility, terminal ambiguity and browser/device cadence affect results. CPU inference is slow; long/heterogeneous proposals require review/re-record and bounded candidates stop at 60 seconds. No independent learner dance, real-human webcam or broad device/session accuracy claim exists.
- **Low:** existing lint/bundle warnings; optional upload proposal feature-adapter reuse is disclosed; hosted deployment is not updated by this local closeout. No unused temporary production probe, fixture-aware matching logic or compatibility deletion remains.

### 12. Release Decision

**NOT MVP READY.** Build, persistence, core cycle workflows, software/resource checks and the primary limited squat-recognition evidence pass. Nevertheless, the required actual dance sequence UI demo/test gate fails; the full movement suite is not green. This decision is **not** based on failing front squats or a demand for universal recognition. Recorded-source sequence success cannot stand in for a working fresh-inference sequence demonstration. Failed evidence remains available and acceptance has not been loosened. The local app is runnable at `http://localhost:5173`; controlled live-cycle and uploaded-cycle demos work, but the complete requested MVP demo is not ready. **Manual commands required: none.**

## 27. Final 20-Target MVP Release

This section supersedes earlier release conclusions, not their evidence. Sections 1-26 are unchanged; the preceding closeout is retained under its historical heading. Fresh evidence: [final-20-target-mvp](../test-results/movement/final-20-target-mvp/). Expert review answers in automated workflows are simulated; video decoding, inference, matching and persistence are real.

1. **Product principle.** The teacher demonstration defines perfection for that lesson, not globally correct technique. The learner video is not ground-truth perfect movement. Scores represent similarity to the teacher demonstration. Cross-teacher recognition and physical-attempt annotations are diagnostics, not required learner counts.

2. **Final architecture.** MediaPipe Heavy VIDEO -> `mediapipe-articulated-3d-v1` -> coherent independent observed teacher references -> at most 20 geometrically selected ordered targets -> one causal matcher for progress/ghost/coaching/completion -> quality against those same targets. Signed body-relative unit directions, bends, confidence masking and normalization remain unchanged. Tolerance **0.25**, confidence **0.3**, fixed **3:1** direction/bend weighting; legacy angle addon remains zero. No OAS fit, new RTMW3D/Python dependency, coordinate averaging, action/view/filename/timestamp classifier, generic apex, generated dwell or online accumulated-history DTW is introduced. The old completed-candidate DP score is offline diagnostic tooling, never a completion veto; its bounded pose-compaction utility remains reused.

3. **Difficulty.** Resolution only: **1/20/50/75/80/99/100 -> 4/7/12/16/17/20/20 targets**, capped by available distinct geometry. Selection preserves actual same-source endpoints and important geometric turns. Identical pauses add no arc. Forward search remains at most three targets at every difficulty; tolerance, confidence, weights, holds and timeout do not change.

4. **Completion and quality.** Each reference keeps an independent monotonic cursor; no phase borrowing. A compatible start, supported ordered progression, meaningful excursion/travel, terminal geometry, confidence and explicit requested holds are required. Sequence starts cannot be admitted merely because terminal geometry overlaps the start tolerance. Local direction uses displacement since the last reached target; terminal progression follows the same directional evidence. A blocked endpoint restores the best supported intermediate, not an invented penultimate position. Cycles emit one `REP_SUCCESS`, finalize quality and reset; sequences emit one `SEQUENCE_COMPLETE`, zero reps, and never wrap. Imperfect completed movement can have 100% progress and less than 100% quality; a high-quality beginning alone cannot complete.

5. **Squat Teach.** Fresh production upload/review/save/reload: **994/994 valid observations**, eight proposals, **five confirmed eligible independent references / 20 targets each**, three excluded fragments. Raw source lengths **38/43/40/131/38** remain retained; the long fourth episode still requires teacher judgment. Saved lesson `9b3b9308-27a0-4f88-a27f-6823e753d72a` reloads exact canonical geometry locally and remotely. Every eligible source produces exactly one rep at 20/50/75/80/100: **25/25**. Normal, endpoint-preserving half density, doubled observations and internal drops at 75: **20/20**. Static/partial controls produce zero reps. Diagnostic cross-reference recognition is **5/20 non-identity pairs**, not a release gate. Full matrix and feature data: [teacher-validation.json](../test-results/movement/final-20-target-mvp/teacher-validation.json).

6. **Dance Teach.** Fresh sequence upload/review/save/reload: **153/153 valid observations**, one coherent reference, **20 targets**, no apex/generated dwell. Saved lesson `66ab227f-58f9-438d-8043-abceecd6eb91` retains exact geometry. Stored-source replay yields **one sequence / zero reps at all five difficulties**; reverse rejects at **all five**, and doubled source replay produces one sequence with no wrap. Source quality at 100 is **98.95%**, not artificially forced to 100. Actual fresh upload UI replay also completes once at every requested difficulty; final per-run pose/event/latency evidence is in `dance-ui-{difficulty}.json`.

7. **Frozen independent learner.** Final whole lesson plus **12 matching/input file hashes** were frozen at **2026-10-05T21:59:39.961Z**, SHA256 **eb93792bb157947322234033ca05ed92d7a92ecb4356a3442ba6f84a4c789024**, before final fresh learner inference. In difficulty order 20/50/75/80/100: **4/4/4/4/4 natural completions**, mean completed quality **86.67/84.65/87.31/86.53/86.99%**, delivered **499/517/511/510/494**, usable **497/510/501/504/493**, wall time **71.846/69.706/68.597/70.308/69.172 seconds**. All have one EOF/final evaluation, zero camera calls and zero movement-service requests. No expected rep count was imposed. [learner-stream-validation.json](../test-results/movement/final-20-target-mvp/learner-stream-validation.json) retains continuous boundaries, all per-reference candidates, winning references and separate annotation-window results.

At 75, continuous completions: **12.843s R3 / 92.02%**, **16.771s R4 / 82.08%**, **26.203s R1 / 87.19%**, **31.106s R1 / 87.94%**. R1=`1c238f1a`, R3=`eb92a1fe`, R4=`cccb9d98` (full UUIDs in raw evidence). Cropped front1/front2/side1/side2 each complete once: **92.02/82.08/86.40/88.23%**. Largest winning feature errors: front1 **left elbow 40.08 degrees**, front2 **left upper arm 83.41**, side1 **left upper arm 59.67**, side2 **left upper arm 52.28**. Crop boundaries can change alignment/quality and are not production rules. Front/side labels never influence reference construction or matching. Old whole-window DP distances remain expressly non-authoritative diagnostics.

8. **Negatives.** Setup/walking, between-attempt turn/standing and exit yield **zero reps at every difficulty**, both standalone and by continuous completion-event windows. Partial progress is preserved: setup **0/18.18/20/12.5/42.11%**, turn **33.33/18.18/13.33/18.75/15.79%**, exit **16.67/9.09/20/12.5/15.79%**. Generic regressions cover static, incomplete, endpoints-only, disconnected observations, opposite/reversed movement, missing confidence, tracking-gap reset, short dropouts, explicit holds, coarse outbound-half rejection and sequence no-wrap. No tested negative full completion is hidden as a low quality score.

9. **Product/lifecycle.** Camera and uploads retain the same detector, descriptor, `LearningRun`, matcher and quality logic. Recorded input uses inference backpressure in the shared pose loop: pause during inference, sample by media time, resume only while active. This prevents inference stalls from discarding recorded stages; webcam capture stays real-time, and processing wall time is not movement progress. Upload calibration observes framing/readiness only, rewinds to zero and auto-finalizes at EOF exactly once. Primary saved-lesson UI: **four reps / 84.34%**, visible pixels **11860 teacher / 37177 learner**, EOF/results **45.4 ms**, no camera/movement requests. Retry/reject, all-unchecked save prevention, duplicate-save guard, failed model analysis, invalid media, corrupt lessons, permissions/voice errors and clean Home/re-entry remain covered.

10. **Performance.** Measured GPU Heavy mean/p95: squat **45.871/49.000 ms**, dance **125.292/98.200 ms**; descriptor **0.3618/0.100 ms** and **0.0876/0.100 ms**. Warmup/stalls can make mean exceed p95; these measurements are retained, not smoothed. Difficulty100/20-target Node matcher: one reference **0.0654/0.1203 ms**, all five **0.1672/0.2321 ms**. Completed aligned-quality scoring over 25 teacher completions: **0.02255/0.0357 ms**. CPU probe **32/32 descriptors**, inference **192.994/242.700 ms**, descriptor **0.325/1.100 ms**, no external model requests. CPU is functional but approximately 4-5 FPS here, not demonstrated real-time 15 FPS. Primary playback wall time is **68.597-71.846 seconds** for 36.436-second media. Final dance EOF/results latency at 20/50/75/80/100: **1678.4/31.0/28.6/757.2/57.3 ms**; outliers remain recorded. No hardware-independent timing guarantee is claimed.

11. **Compatibility.** Existing 2D, RTMW3D and Heavy/OAS lessons keep their explicit trackers and unchanged stored geometry; no silent migration. Older articulated lessons are bounded to <=20 runtime targets without rewriting stored observations. `DTWProgressTracker` has no new production caller. The full-list lessons API remains available; normal library navigation now uses a compact validated metadata catalog and fetches full geometry on selection, including newer remote revisions.

12. **Preserved failures.** Historical `final-mvp` and `release-mvp` evidence is untouched. This closeout preserves initial catalog timeouts, the first 100-difficulty dance stall, the inference-stall 75 replay, the rejected turn-skipping variant that admitted reverse, coarse reverse/endpoint regressions, an earlier five-event learner run, and camera failures/traces. Safety corrections came from teacher-only negatives, generic endpoint tests and input lifecycle evidence, not learner count/quality tuning. The camera harness now models independent acquisitions and a continuous camera holding its final decoded frame rather than ending its stream at movement EOF; it waits for recording review before reading the passive capture. Test completion/resource assertions remain intact.

13. **Known limits.** Teacher-reviewed segmentation can propose long/heterogeneous episodes. Inferred depth, visibility/viewpoint, repeated similar geometry and device/browser cadence limit generalization; completion is not certified physical-repetition counting or global technique assessment. Earlier worse counts and separately compiled regression results remain retained. CPU operation is slower than GPU; candidate movement spans remain bounded to 60 seconds. No independent learner dance or physical-human webcam accuracy is claimed. Existing lint/bundle warnings and the unmodified hosted deployment remain non-blocking limitations, not evidence of universal recognition.

14. **Final software/product checks and decision.** Final verify: **215 unit tests / 35 files**, both typechecks, zero lint errors (three existing warnings), production build passed. Python compatibility **82 passed**. Final general Chromium **11 passed**, Level-B **8 passed**, fresh teacher UI **2 passed**, final frozen learner matrix/saved-lesson UI **2 passed**, explicit final dance UI **5 passed**, full movement **16 passed / 7 opt-in skipped**. These selected browser commands total **44 passing executions**, not unique cases; focused repair runs and numerical replay checks are not inflated into that total. Required fresh opt-ins were run separately, not counted as skips-as-passes. The complete camera-fixed movement log is [full-movement-stable-camera.log](../test-results/movement/final-20-target-mvp/full-movement-stable-camera.log).

The final separately compiled regression teacher produced **4/4/4/4/4** learner completions, quality **85.86/84.23/89.23/87.30/88.53%** (exact values in its raw matrix). An earlier complete run produced **4/2/3/4/2**; its full raw command results remain in `full-movement-release.log`, not substituted for the primary frozen comparison. Controlled camera Teach/save -> same saved lesson Learn produced **one natural rep**, with camera/microphone and pose-loop cleanup; prerecorded camera evidence does not establish human webcam accuracy.

Final interactive browser walkthrough: fresh squat Teach/upload, proposal replay/rejection, save/reload, actual learner upload/calibration/rewind, visible skeleton/ghost/progress/quality/coaching, rep display and automatic EOF/results; fresh dance Teach/save/reload and actual teacher-source sequence replay. Reviewed cycle excluded the long proposal and saved **four independent 20-target references**; its learner replay showed **four completed reps / 89% quality / 12 corrections**. The fresh sequence saved **one 20-target reference** and showed **Sequence Complete / 97% / three corrections**, no repetition count and no remaining video elements. Desktop **1280x900** and mobile **390x844** fit without horizontal overflow; normal viewport restored and clean Home retained. Walkthrough expert/prediction responses were explicitly marked simulated. A Work Map wording mismatch was corrected and tested: generic cycle checkpoints now display cycle, sequence demonstrations display sequence; stored phases/geometry remain unchanged.

**Critical/High remaining issues: none demonstrated in these release gates. Medium:** limited model/viewpoint/generalization accuracy, reviewed segmentation, slow CPU, bounded long-movement support; no learner dance/human-webcam accuracy claim. **Low:** existing warnings and hosted deployment not updated. Matching/teacher hashes and Sections 1-26 remain exact; no new fixture branches, `.only`, weakened completion assertions or test/server/media leaks remain. Existing local dev server was reused and retained intentionally; validation command/browser processes stopped. No commit, push, deploy or publish was performed. Exact changed-file/evidence manifests and walkthrough record are in the new evidence directory.

**FINAL MVP READY.** All specified release gates pass. No manual commands or actions are required.
