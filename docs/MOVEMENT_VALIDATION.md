# Movement Pipeline Implementation and Evidence

Validated on Windows/Chromium, 2026-10-04. This is an implementation report, not a revised design. The student squat outcomes below are empirical results, not acceptance targets.

## 1. Files Added and Modified

Added:
- `src/frontend/analyze/SequenceAnalyzer.ts`
- `src/frontend/learn/ProgressTracker.ts`, `LearningRun.ts`, `LearnerVideo.ts`
- `src/frontend/lesson/RuntimeTargets.ts`
- `src/frontend/pose/PoseAngles.ts`
- `src/scripts/level-b/runMovementValidation.ts`, `measure-movement-angles.ts`, `compareMovementEvidence.ts`, `replayMovementEvidence.ts`
- `tests/unit/ProgressTracker.test.ts`, `SequenceAnalyzer.test.ts`, `LearnerVideo.test.ts`, `PoseAngles.test.ts`
- `tests/movement/position-matrix.spec.ts`, `upload-lifecycle.spec.ts`, `playwright.movement.config.ts`
- `data/lesson-dance.mp4` and this report.

Modified:
- `config.json`, `src/shared/config/config.types.ts`
- `src/frontend/pose/pose.types.ts`, `PoseComparator.ts`, `PoseRenderer.ts`
- `src/frontend/lesson/CanonicalMovementBuilder.ts`, `LessonCompiler.ts`, `LessonSchema.ts`
- `src/frontend/analyze/SessionAnalyzer.ts`, `analyze.types.ts`, `QuestionBuilder.ts`
- `src/frontend/teach/SkillSetup.tsx`, `TeachFlow.tsx`, `RecordingReview.tsx`, `teach.types.ts`
- `src/frontend/review/LessonReview.tsx`
- `src/frontend/config/RuntimeConfig.ts`, `ConfigPanel.tsx`
- `src/frontend/learn/LearnFlow.tsx`, `CoachingSession.ts`, `ghostPose.ts`, `MasteryReport.tsx`
- `src/frontend/components/LiveStage.tsx`, `src/frontend/media/CaptureSourceControls.tsx`, `src/frontend/app/AppMachine.ts`
- `src/frontend/apprentice/SemanticPipeline.ts`, `src/backend/services/ApprenticeStructured.ts`
- `tests/unit/CoachingSession.test.ts`, `QuestionBuilder.test.ts`, `SessionAnalyzer.test.ts`, `SemanticPipeline.test.ts`
- `tests/e2e/teach-fixture.spec.ts`, `tests/level-b/live-flows.spec.ts`

Pre-existing edits in `App.tsx`, home/layout/runtime-config E2E tests, and the Level B pipeline test were preserved. Original untracked videos were preserved. Test-generated lessons remain local artifacts; they are not authored product lessons.

At inspection, the expected squat teacher and learner clips existed. The expected dance path did not: the original existed at `videos/lesson-dance.mp4`. It was copied, without changing content or deleting the original, to `data/lesson-dance.mp4`. Both dance copies have SHA-256 `8865b633f0e1cbb580bcf4dcedc3fe8db1ff1f01daa5d804303f3e16711121c3`. No product decision was changed.

## 2. Architecture and Schema

- The outer Lesson remains schema version 1. `canonicalMovement.schemaVersion` is 2, with `kind`, dense ordered `samples`, semantic `anchors`, and legacy `checkpoints`.
- `progress01` is an ordered sample-index path parameter. Teacher timestamps locate observed phase boundaries; teacher elapsed time never advances learner progress or the ghost.
- Both kinds use `ProgressTracker`. Its named forward window is 0.15 canonical progress and its normalized geometric neighborhood radius is 0.25. Neither derives from FPS or runtime target count.
- An observed geometric segment can support multiple dense targets. Only semantic anchors require continuous 150 ms holds. Invalid poses or large gaps reset holds. Unsatisfied anchors bound progression; cycles reset only after completion and sequences lock after one completion.
- Identical geometric plateaus advance only inside that same bounded neighborhood; constant canonical paths are rejected. A noise-free exact anchor match is not required beyond the unchanged geometric tolerance and hold.
- The ghost comes from the tracker's next target/anchor. Normal practice UI shows phase, not checkpoint percentages.
- Camera and uploaded learner video use MediaPipe VIDEO plus `LivePoseLoop`, then `LearningRun.processStudentFrame`, the same normalization/comparison/tracker and `CoachingSession`. Fixtures feed the same frame processor. There is no learner IMAGE extraction pipeline.
- Learner-video calibration starts at zero, finds a consecutive stable 500 ms body window, then rewinds. The controlled video survives UI stage transitions. Dispose stops playback, RAF, listeners, pending media waits, and the detector.
- Run start, progression, learner-video calibration, coaching, and final evaluation carry the learner run ID. Final summaries are idempotent and include difficulty, targets, progress, source, frames, reps/sequence completion, coaching, mastery, and termination.
- Sequence setup/review/compiler and model coaching preparation explicitly use sequence semantics, without fabricating an apex or return.

## 3. Backward Compatibility

Loading upgrades in memory only: use existing dense samples; otherwise rebuild from demonstrated trajectories; otherwise interpolate ordered legacy checkpoints and report `trajectorySource: legacy_checkpoints`. Missing kind means cycle. Saved input records are not rewritten. Nine cycle checkpoints remain available to legacy review/UI. The old standalone `CheckpointTracker` API remains for its existing regression tests, but production Learn uses `ProgressTracker` for both old and new lessons. Leniency and sample FPS are unchanged and independent of difficulty. Old config files gain default difficulty 75 and angle weight 0 through the existing merge path.

## 4. Tests and Failures

Final verification: 106/106 unit tests, 11/11 ordinary browser tests, 8/8 Level B tests, typechecks, lint (zero errors), and frontend/backend production builds passed. Final uploaded-learner desktop/mobile lifecycle test passed. The POSITION matrix test and experimental ANGLES matrix test each passed their lifecycle/schema assertions, without asserting a required rep count. These total 128 passing test executions across final regression suites, two separately parameterized matrix runs, and the uploaded UI test; repeated development reruns are not counted. No final failure or skipped test remains. The real semantic acceptance test covered 16/16 narration points with six aligned demonstrated points; a real voice session opened twice and closed both sockets.

Important earlier failures were fixed, not erased:
- Anchor noise and identical canonical plateaus initially prevented the existing student-good fixture from completing. Focused regressions cover both corrections. Saved fixture replay now completes a repetition without a changed threshold.
- The first Level B rerun recorded a genuine fake-webcam repetition, but the existing test broke its match-variation observation loop immediately at success and saw only three values, below its unchanged assertion of more than three. The loop now observes both success and the existing variation condition before exiting; no comparison or test threshold was lowered. Failure trace/context remain in `test-results/movement/level-b-first-regression`.
- One initial matrix attempt was interrupted by development reload; its raw result remains `position-20-interrupted-attempt.json`. The upload UI harness initially seeded storage after the app had loaded its library; its interrupted trace is retained in `upload-harness-interrupted`, and the harness now reloads after seeding.
- Full initial POSITION matrices remain in `baseline-before-anchor-correction`, including Level 75's original 28.70% maximum. Those runs predated correction and did not measure coaching; zero in their coaching field must not be interpreted as measured absence of corrections.

## 5. Runtime Target Counts

For difficulties **1 / 20 / 50 / 75 / 80 / 99 / 100**:
- Cycle: **5 / 5 / 5 / 9 / 11 / 201 / 201**.
- Sequence: **3 / 3 / 3 / 5 / 6 / 101 / 101**.

The single formula returns intervals 99 / 80 / 50 / 25 / 20 / 1 / 1 percent. Sampling applies within each semantic phase: a cycle has outbound and return phases, hence 201 total targets at 1% phase spacing. Default 75 retains the approximate old nine-target density. Anchors are always included and deduplicated. Runtime construction never mutates the lesson.

## 6. Teacher Squat Compile

`data/lesson-squat.mp4`: 994 usable extracted frames, zero low-visibility skips; six complete cycles plus one fragment, in three generic detected regimes. Compiled cycle: 209 dense samples, nine legacy checkpoints, start/apex/completion anchors, each 150 ms. Complete teacher demonstrations were marked good and confirmed by the harness, explicitly as simulated expert labels; this is not a claim of human approval of every demonstration. Full recording, trajectories, segmentation, and lesson: `test-results/movement/teacher-cycle.json`.

## 7. Teacher Dance Sequence Compile

`data/lesson-dance.mp4`: one sequence take, 1133-10133 ms, 136 dense samples, five legacy review checkpoints, start/completion anchors only. Every dense sample has phase `sequence`; there is no apex timestamp and no return-to-start requirement. Terminal dwell is kept long enough for completion holding. `teacher-sequence.json` includes the source poses and compiled lesson. There is no student dance fixture and no fabricated learner-dance success test.

## 8. Student Squat POSITION Results

The same actual video, `videos/test-squat-student_1.mp4`, was processed in shared VIDEO mode at configured 15 FPS, with unchanged leniency 0.25, difficulty varied only. Corrected baseline, in order **20 / 50 / 75 / 80 / 100**:
- Successful reps: **0 / 0 / 0 / 0 / 0**.
- Maximum progress: **20.37037% at all five levels**.
- Delivered usable frames: **532 / 535 / 534 / 534 / 534**.
- Coaching corrections measured by the shared stack: **14 at every level**.
- Every run satisfied start only, terminated automatically at EOF, and reported `never_reached_apex`; none awarded mastery.

Difficulty 100 is achievable at 15 FPS in the ideal geometric cycle regression: one complete repetition with 150 ms semantic holds, without holding each dense target or count/FPS-based skipping. This is a feasibility result, not a claim that this mismatching real student clip passed.

## 9. Walking, Setup, and Exit

Observer annotations only, never production inputs: setup/walking 0-3 seconds; front-view interval 3-18 seconds; side-view interval 18-31 seconds; exit after 31 seconds. No setup/walking or exit interval produced `REP_SUCCESS` in POSITION or paired ANGLES runs. Setup remained at zero progress. Exit could resemble an outbound pose and add a small amount of partial progress in some runs, but could not satisfy the apex or complete a repetition. Constant-pose and semantic-barrier tests separately prevent idle success.

## 10. Front Versus Side View

Four visible squats were observed, approximately two front-view and two side-view. No success was forced. Both intervals produced zero reps at all five difficulties. POSITION front/side progress reached approximately 19.91-20.37%, then stalled outbound. Angle visibility was strongly asymmetric in side view: only 19 right-knee/right-hip pairs were usable versus 195 left-knee/left-hip pairs at the diagnostic floor. These are test-observer labels; production contains no front/side, squat/dance, filename, or known-timestamp scoring branches.

## 11. Learner Calibration, Lifecycle, and EOF

Baseline stable-window starts were 1675.906 / 1674.877 / 1668.609 / 1641.416 / 1663.346 ms. Every rewind was exactly zero. Every baseline and experimental matrix run had exactly one EOF evaluation and zero webcam requests. Uploaded UI independently verified a common calibration/run/evaluation ID, zero webcam calls, automatic completion without Finish, and stopped media after completion. Desktop/mobile screenshots and canvas-pixel checks verified a rendered overlay while frame counts continued increasing. Unit tests cover unstable/dropout windows, cancellation during metadata waiting, idempotent finish, repeated ended events, and rejection of frames after final evaluation.

## 12. Webcam Regression

Existing fixture Teach/Learn persistence and successful-repetition regression passed. The first real MediaPipe fake-webcam Level B run completed one rep in 54 delivered frames; its failure was the observation-loop issue described above. The final 8/8 Level B pass completed one webcam rep in 65 frames, with one coaching correction, four sampled positive match values, and 17 progression events. Camera acquisitions/releases were 2/2 and pose starts/stops 3/3; Learn-to-Teach reset passed. Chromium replayed recorded media as a camera; no physical webcam or live human performance is claimed.

## 13. Angle Error Measurements

Measured only after the POSITION baseline existed. Diagnostic projected angle differences at tracked progress, visibility floor 0.65 and minimum projected limb length 0.1, from 534 Level-75 frames:
- Left knee: mean 17.01 degrees, median 5.65, p95 77.97, 495 pairs.
- Right knee: mean 15.86 degrees, median 8.80, p95 57.00, 267 pairs.
- Left hip: mean 18.85 degrees, median 4.73, p95 90.04, 519 pairs.
- Right hip: mean 13.68 degrees, median 7.24, p95 49.17, 286 pairs.
- Left elbow: mean 65.55 degrees, median 21.21, p95 147.39, 128 pairs.
- Right elbow: mean 92.11 degrees, median 125.80, p95 137.43, 226 pairs.

Front-view left/right knee mean errors were 16.46/15.83 degrees; side-view means 22.06/19.34 degrees, with only 19 reliable right-side pairs. These compare against the stalled canonical alignment, not independently annotated technique ground truth. They cannot establish that the student is performing incorrectly. Per-frame measurements and ghost-target comparisons remain in `angle-measurements.json`.

## 14. Angle Weights and Gates

Production `pose.angleWeight` remains **0**. The observed projection/visibility errors and lack of independent correct/incorrect expert labels do not justify enabling an angle gate. Optional experimental weight is capped at **0.05**, strictly subtracts from positional similarity, and requires at least three reliable angle chains with visibility at least 0.8 and projected limbs at least 0.1 normalized units. Missing/degenerate chains bypass the penalty rather than becoming a failure. There is no hard angle gate, and no dependency on density, difficulty, movement type, view, or fixture. These are conservative geometric reliability safeguards, not tuned acceptance thresholds. Identical geometry has zero penalty; exactly two reliable chains cannot activate it.

## 15. POSITION Versus POSITION+ANGLES

Both the real VIDEO reruns and exact-pose paired replays are preserved. At difficulties **20 / 50 / 75 / 80 / 100**:
- POSITION: **0 reps at every level**, progress **20.37 / 20.37 / 20.37 / 20.37 / 20.37%**.
- Real VIDEO, experimental weight 0.05: **0 reps at every level**, progress **27.78 / 20.37 / 20.37 / 20.37 / 20.37%**; delivered frames **533 / 534 / 536 / 530 / 533**, 14 corrections each.
- Exactly the same captured poses under both options: ANGLES progress **27.78 / 20.37 / 20.37 / 27.78 / 20.37%**, still zero reps. Differences from real-video reruns reflect sampling/inference variation; they have not been normalized away.
- Paired ANGLES had nonzero penalties on 261 / 262 / 263 / 234 / 261 frames; maximum observed penalty was 0.04014. Penalties can change which local candidate wins and therefore alter partial alignment despite never increasing a candidate's similarity. Greater partial progress is not evidence of improved technique detection or increased repetition success.

## 16. Remaining Issues

- **Critical:** none identified by completed checks.
- **High:** the real cross-person/student clip has zero accepted reps at every required difficulty. Teacher labels were simulated across multiple demonstrated variations/views, so this evidence cannot distinguish legitimate rejection from poor canonical generalization. No thresholds were weakened and no teacher take was specially selected to improve this fixture's score.
- **Medium:** projected joint angles are not validated technique ground truth and have serious view/occlusion limitations; production weighting stays disabled. No student dance clip or physical-webcam validation exists.
- **Low:** three pre-existing Fast Refresh lint warnings, the existing mixed import warning, and a greater-than-500 kB application bundle warning remain.

## Reproduction and Raw Evidence

Run `npm run verify`, `npx playwright test --config=playwright.config.ts --workers=1`, and `npx playwright test --config=playwright.level-b.config.ts`. Run the default movement suite first: `npx playwright test --config=playwright.movement.config.ts`. For the experimental VIDEO rerun, set `MOVEMENT_ANGLE_WEIGHT=0.05` and run that suite again; its filenames are separate from the POSITION baseline. Then run `node --import tsx src/scripts/level-b/measure-movement-angles.ts` and `node --import tsx src/scripts/level-b/compareMovementEvidence.ts`. Teacher cache reuse is guarded by a source/video fingerprint; test assertions never force a specific repetition count.

Raw data remains locally under `test-results/movement`: both teacher artifacts, `position-{20,50,75,80,100}.json`, `position-matrix.json`, `position-angles-{difficulty}.json`, `position-angles-matrix.json`, `paired-{position,angles}-{difficulty}.json`, `paired-matrix.json`, `angle-measurements.json`, `upload-lifecycle.json`, desktop/mobile screenshots, and the preserved earlier runs/failures. Raw files include detected learner poses and chronological tracker events, not just successful summaries. `test-results` is already ignored by Git; these files are retained in this workspace, while this report is a repository document. Real semantic regression evidence is also in `test-results/level-b-semantic-report.json`; typed expert responses are explicitly marked simulated.

## 17. Real-Student Generalization Diagnosis (No Production Changes)

### Diagnosis and Recommended Next Experiment

**A. Primary failure:** geometric/canonical mismatch, not Match Difficulty Level and not primarily ProgressTracker. Canonical construction is the clearest first failure: its coordinate-wise median blends six view/style/phase-different demonstrations into geometry that even the teacher often cannot match. View-sensitive absolute normalized XY positions and a view-dependent body-scale denominator are additional strong obstacles, especially in side view. The experiment does not cleanly separate those two effects, nor prove true anatomical proportion differences from one learner.

**B. Decisive evidence:** the complete 534-frame x 209-pose POSITION matrix contains no passing apex in any physical attempt. Front apex maxima are 0.739579 and 0.733751; side maxima are 0.224592 and 0.326107, against the unchanged 0.75 cutoff. Removing all local-window/order/hold restrictions still does not expose a full POSITION path. More importantly, 75/209 canonical poses have no passing match anywhere in the six actual source trajectories. The canonical apex's nearest source distance is 0.446878, exceeding the allowed mean distance 0.3125. Teacher phase-aligned median similarity is only 0.611450. These observations precede any cross-person comparison.

**C. Smallest principled candidate change, NOT implemented:** first test a whole-demonstration medoid instead of independent-coordinate medians, after teacher review of the existing source phase/anchor annotations. A medoid must be one actual coherent demonstration, selected by a generic aggregate distance objective, not by student success, movement name, camera label, or fixture identity. Preserve all twelve scored joints, leniency, local tracker rules, path support, semantic holds, and negative-motion rejection. This removes hybrid skeletons without granting arbitrary arm-position tolerance or widening the acceptance threshold. It is a bounded next experiment, not evidence that a single medoid will accommodate all views or preserve every negative rejection.

Run a preregistered offline median-versus-medoid comparison on all six teacher sources with leave-one-demonstration-out evaluation, the unchanged learner frames, and setup/walking/exit intervals. Report every source, not just a favorable take. Audit phase consistency before attributing any improvement to the aggregation statistic. Only if teacher self-consistency improves while negative discrimination remains intact should a second experiment address generic confidence-aware, bone/kinematic representations. Do not substitute a lower-body-only production matcher: the negative controls below show why.

**D. Generality:** source-coherent aggregation and source/anchor validation apply to arbitrary cycle and sequence trajectories; no squat-specific rule is proposed. A single 2D medoid is not viewpoint invariant and does not solve limb-proportion or occlusion problems. Selecting only front-view or side-view examples for this fixture would not establish generality.

**E. Production decision:** keep production unchanged until another independently labeled learner video and negative-motion examples are collected. One learner and simulated teacher approvals cannot justify new production representations, tolerances, weights, or acceptance gates. The proposed medoid experiment is also unimplemented in this investigation.

### Inputs, Scope, and Provenance

The offline replay uses the accepted `teacher-cycle.json` and `position-75.json`, not a fresh inference run or a separate learner pipeline. Both full inputs are copied under `test-results/movement/generalization/`, with input SHA-256 values, media metadata, config, and production file manifests. The teacher video is 640 x 360 at 24 FPS; the learner video is 1920 x 1080 at approximately 14.96 FPS. Both are 16:9, so differing source aspect ratios do not explain this result.

All 534 recorded learner frames are usable at the existing usability floor. Each is compared against all 209 dense canonical samples in eleven diagnostic ablations: 111,606 cells per matrix, 1,227,666 total cells. Full-precision JSON and CSV matrices are independent of the tracker. Diagnostic global candidates never feed production matching. No production files, configuration, leniency, angle weights, tracker rules, canonical generation, or thresholds were edited. Hashes cover 146 files: frontend/backend/shared sources and configuration.

The source teacher harness marked all six complete demonstrations good/confirmed using **simulated** expert labels. The investigation neither silently removes an unfavorable source nor claims human approval. Three sources are visually front view and three side view, with different arm arrangements, ranges, and phase timing. The dense builder uniformly phase/index-resamples each source and takes separate medians for x/y/z/visibility at each joint. Canonical identity similarity is exactly 1 for all 209 samples, a sanity control rather than teacher-generalization evidence.

Manual learner annotations, reporting only, correct the earlier coarse intervals in Sections 9-10: front attempt 1 about 9-14 s, front attempt 2 about 14-18 s, side attempt 3 about 23-28 s, side attempt 4 about 28-33 s; exit begins about 33 s. Other frames include initial walking/standing and the intervening turn/setup. Contact-sheet boundaries are approximate, about +/-0.5 s for the learner and +/-1 s for the two-second teacher sheet. No matcher receives those labels or timestamps. The observed-bottom locator uses the minimum projected left-knee angle within each manually observed attempt; it is not technique ground truth or a proposed generic apex detector.

### The 20.37% Barrier

Exact unchanged replay agrees with every accepted Level-75 progress observation. Replaying the same poses at difficulties 20/50/75/80/100 yields 20.370370% at every level, start satisfied only, `never_reached_apex`, and no successful repetition. This eliminates differing inference/sampling between difficulty runs as an explanation of the invariant barrier.

The tracker first reaches its final 20.370370% at 16.841104 s, during the second front-view attempt's return toward standing. Immediately before that update it is at 19.907407%. The chosen dense candidate at 20.370370% scores 0.752817; the next dense sample at 20.833333% scores 0.743169 and fails. The visible runtime target is 25%, similarity 0.670062. All three are within the local geometric neighborhood: this immediate stop is a similarity failure, not a window exclusion.

At that frame, the scored elbows and left wrist account for 0.201845 of the target's 0.329938 similarity loss, **61.18%**. Against the selected dense candidate they account for **64.95%** of the loss. The right wrist's visibility is 0.645094, below 0.65, and is excluded; it contributes zero actual score loss. Hips are small errors, while knees and ankles contribute additional mismatch. The target upper-arm positions differ strongly from the learner's crossed/front-held arms. Thus this is not a single invisible wrist poisoning the average.

There are 292 subsequent frames without progress. Overlapping diagnostic guards report 282 selected-local-score failures, 50 better-candidate/intermediate-target support failures, and 10 frames with no better supported forward geometry. These are not mutually exclusive counts. Passing forward candidates do exist later: the maximum eligible forward-local similarity is 0.785255. However, the ten post-barrier frames with passing later outbound geometry are all exit frames, around 33.97-35.31 s, not a hidden successful side squat. Path support/order correctly prevents treating those isolated future matches as a complete traversal.

The next semantic anchor remains apex at 50%. From 20.37%, the local progress upper bound is 35.37%, so apex is inaccessible; it also never attains passing similarity anywhere in the video. No pending apex hold is the dominant stall reason, and the anchor must not be bypassed. `frame-diagnostics.json`/NDJSON contain every pre/post progress observation, actual local comparisons, geometric eligibility, path-support failures, target/candidate similarities, per-joint visibility/distance/score contribution, event, exact guards, and next unsatisfied anchor. `barrier.json` includes the last accepted frame and the +/-1.5 s neighborhood.

### Entire-Trajectory POSITION Findings

Attempt results use the unchanged 0.75 similarity cutoff. "Ordered prefix" is optimistic dense-sample coverage in nondecreasing learner-frame order: it ignores local windows, geometry neighborhoods, target density and holds, and may cover several samples with one frame. It is an upper-bound diagnostic, not tracker progress or a repetition award.

- **Front 1:** ordered prefix 22.6852%; maximum unordered outbound match 26.8519%; best apex 0.739579; apex at observed bottom 0.678611. A standing/return frame matches completion at 100% unordered, but the intervening apex is absent. No coherent POSITION cycle.
- **Front 2:** ordered prefix 24.5370%; maximum unordered outbound match 31.0185%; best apex 0.733751; apex at observed bottom 0.642340. Maximum unordered overall match is 78.5%, again without traversing apex. No coherent POSITION cycle.
- **Side 3:** no start match and no passing canonical sample anywhere in the attempt; best apex 0.224592, bottom 0.210302. No coherent POSITION cycle.
- **Side 4:** no start match and no passing canonical sample anywhere in the attempt; best apex 0.326107, bottom 0.093097. No coherent POSITION cycle.

Some later return/completion geometry is a good match in the front attempts. Therefore the conclusion is **not** "nothing beyond 20% ever matches." It is "passing future standing/return poses do not constitute a contiguous outbound-apex-return path." Expanding the window cannot supply the absent apex or repair the globally disconnected trajectory. Tracker constraints contribute to the exact 20.37% stopping point, but are not a sufficient cause of zero repetitions.

### Canonical and Teacher Self-Consistency

Across 6 x 209 phase-aligned teacher-source comparisons, similarity mean/median/p95 are **0.535542 / 0.611450 / 0.827079**; 1,010/1,254 samples are below the production cutoff. Demonstration medians, in source order, are **0.659571 / 0.754290 / 0.732477 / 0.532300 / 0.333537 / 0.150418**. All six source apex poses fail against the median apex: **0.619554 / 0.594100 / 0.617719 / 0.558089 / 0.273534 / 0**.

The canonical nearest-any-source mean distance is 0.281348; p95 is 0.446752. Seventy-five canonical samples, including apex, are farther than 0.3125 from every pose in the six actual source trajectories. At apex, two projected limb lengths are below the phase-aligned source range; 158/209 samples have at least one such outside-range limb. This establishes off-source geometry and warns of hybrid skeletons, but does **not** prove anatomical impossibility: phase misalignment, perspective and visibility also affect the comparison.

All six individual source trajectories were separately compared to the student as diagnostic controls. The three front-source apex maxima against the two front attempts range 0.771995-0.824042 and 0.829338-0.857995, respectively, all above 0.75; their median-canonical counterparts remain below 0.75. Some source controls yield long ordered prefixes (up to 96.5%), but none yields a full cycle. The sixth side-source apex matches the two side attempts at 0.804403/0.800505, while its ordered prefixes are only 26.8519%/68.5%. These controls implicate canonical blending without establishing a production source-selection solution.

Stored apex timing also needs review. In the last teacher source, the stored apex is 57.667 s (projected left-knee angle 137.748 degrees), whereas the visible reliable projected minimum is 61.067 s (96.259 degrees), 3.4 s later. In source five, the minimum occurs 3.133 s later but has nearly the same shallow angle (138.410 versus 138.975 degrees), so that timing gap alone is not proof of an incorrect apex. Source four's stored apex is within 0.666 s and 1.385 degrees of its reliable projected minimum. The audit preserves each result rather than treating all timestamps as bad or replacing them with squat-specific minima.

### Per-Joint Distributions

Normalized XY distance mean / p95, scored joints only, comparing teacher phase-aligned versus learner diagnostic phase-aligned:

- Shoulders: teacher **0.5530 / 1.0643**, learner **0.5828 / 1.4039**.
- Elbows: teacher **0.7334 / 1.9326**, learner **1.1361 / 2.4748**.
- Wrists: teacher **0.9510 / 2.1241**, learner **0.7410 / 1.1062**.
- Hips: teacher **0.0542 / 0.1022**, learner **0.1239 / 0.2708**.
- Knees: teacher **0.5178 / 1.2478**, learner **0.6085 / 1.4689**.
- Ankles: teacher **0.5728 / 1.8462**, learner **0.8447 / 2.1778**.

The learner phase alignment is an observer-located, sample-index split at its own projected knee minimum, not teacher elapsed time. Global-nearest, current-target, stalled-local, each-bottom and per-joint visibility/contribution distributions are saved separately; they must not be conflated. For example, learner global-nearest attempt elbow mean error remains 0.9938, while hip mean error is 0.1187. Small hip errors are partly guaranteed by hip-centering and are not independent validation of movement quality. Side wrists/right elbow/right knee frequently do not qualify; aggregate wrist means can consequently look better than the teacher's despite severe side-view failure.

### Diagnostic Ablations and Coherence

Every ablation uses the same normalized inputs and visibility floor. POSITION-derived ablations keep the same distance-to-similarity mapping and 0.75 cutoff. Angle-only uses the declared diagnostic mapping `1 - mean absolute angle error / 180`, requiring three reliable chains; this cutoff is **not** tolerance-equivalent to POSITION. No cutoff was tuned to obtain repetitions.

- **Existing 12-joint XY:** optimistic prefixes 22.69%/24.54%/no start/no start; zero full or physically phase-constrained coverage.
- **Lower body (hips/knees/ankles):** optimistic and physically phase-constrained full coverage in both front attempts; neither side attempt starts. Apex maxima 0.837335/0.836394/0.392761/0.357274. At the exact front bottom frames, apex scores are only 0.734621/0.670106; nearby frames within the +/-0.5 s diagnostic band do pass. This is an approximate phase-correlated match, not a measured successful rep.
- **Torso + lower body:** full approximate phase coverage in both front attempts; neither side starts. Apex maxima 0.819815/0.807577/0.339316/0.390237. Exact front-bottom scores 0.729784/0.675873 remain below cutoff.
- **Remove wrists:** both front prefixes reach 84% and fail return coverage; neither side starts. Apex maxima 0.760706/0.766062/0.224592/0.326107. Side results are unchanged because their wrists already fail visibility.
- **Remove elbows + wrists:** identical to torso + lower body by construction; not independent evidence. Both fronts have approximate full phase coverage; neither side starts.
- **Normalized angles only:** both fronts have full optimistic and phase-constrained coverage, but the unconstrained witnesses finish at 9.375 s and 14.042 s, before the physical squat bottoms at 11.904/15.975 s. The second can cover every column with one still-standing frame. Both side attempts have no cells with three reliable chains (15,675 missing cells each). This scale is insufficiently discriminative and cannot support a production success claim.
- **XY + reliable lower-body angles:** conservative, diagnostic-only penalty capped at 0.05, at least three hip/knee chains with visibility >=0.8 and projected limb length >=0.1. Front prefixes 22.22%/24.54%; no side start or full coverage. Apex maxima unchanged because reliable-chain requirements often bypass the penalty. A subtractive gate cannot rescue the absent positional apex.
- **Mirror x plus anatomical left/right swap:** front prefixes 24.07%/22.69%; no side start. Apex maxima 0.711967/0.700537/0.039159/0.236644. No rescue. Separate label-only and reflection-only controls also have no ordered start/full coverage.
- **Normalized XYZ:** no ordered start or full coverage in any attempt; apex maxima 0.299226/0.286231/0/0. This adds the recorded hip-centered, body-scaled image-landmark z, not a new metric-world canonical. World landmarks exist in all 534 learner recordings but are not the stored production canonical representation. The result does not establish that true 3D bone-space alignment could not help; blindly adding this z clearly does not.

`ablations.json` contains full per-attempt maxima, exact bottoms, best-progress curves, column maxima, ordered witness indices and the additional physical-phase coverage check. No ablation is plugged into ProgressTracker, and no diagnostic coverage is converted to a repetition.

### Walking and Negative Controls

The unchanged POSITION replay awards zero repetitions in every region. Its independent matrix cannot cover a full trajectory in initial setup, intervening turn/standing, or exit. It nevertheless has isolated passing exit poses, and a 24.54% optimistic exit prefix, which the actual tracker does not turn into a rep.

Lower-body-only, torso+lower, and remove-elbows/wrists matrices cover the entire canonical in **initial setup and exit**. Lower-body-only initial setup covers every column with the same frame at 1.041 s. Angle-only covers initial setup and the intervening turn/standing; the latter uses one frame at 18.040 s for start, apex and completion. These are not measured false-positive tracker reps because the local tracker/holds are absent, but they directly demonstrate weak geometric discrimination. They disqualify blanket arm removal or angle-only scoring as a justified production recommendation from this clip.

### Thirteen Candidate Causes

1. **Joint dominance: confirmed contributor.** Arms cause 61.18% of visible-target loss at the barrier; later side frames also have substantial shoulder/ankle/knee errors. There is no single joint-only explanation.
2. **Body proportions: unresolved/confounded.** Projected normalized limb lengths differ, but one learner, differing views and arm/posture styles cannot identify true anthropometric differences.
3. **Scale/translation normalization: works for its stated algebraic invariance.** Uniform raw coordinate scaling by 0.6 plus translation leaves normalized XYZ distance at at most 5.35e-15 across 534 frames. Both sources share aspect ratio. This does not test perspective/rotation or pose-estimation quality.
4. **Viewpoint: strong contributor.** Side global POSITION matches fail entirely while front start/return geometry matches. Projected shoulder/hip widths and the normalizer's denominator change strongly with orientation; canonical also mixes orientations.
5. **Left/right orientation: not sufficient.** Mirroring, swapping labels alone and reflecting x alone do not restore coherent paths.
6. **Discarded depth: not resolved by the available XYZ experiment.** Adding image-normalized z worsens results; metric-world/bone-space generalization remains untested.
7. **Style: visible contributor, not quantified independently.** Crossed/front-held learner arms differ from teacher arm arrangements; stance, torso and projected limbs also vary. No correctness judgment follows from those differences.
8. **Median/resampling: strong demonstrated contributor.** Teacher self-consistency and nearest-any-source failures show a poor reference before cross-person matching. Coordinate medians, mixed source regimes and imperfect phase alignment are not experimentally separated here; no anatomical impossibility is asserted.
9. **Local window/order: secondary contributor.** Some later poses are inaccessible, especially return/completion poses; optimistic global ordering still fails the apex. Ten post-barrier passing later-outbound frames are exit, not overlooked physical repetitions.
10. **Semantic anchor: correctly remains unsatisfied.** Apex has no passing POSITION frame; bypassing it would erase a genuine missing semantic condition.
11. **Visibility/occlusion: strong side-view limitation.** Both side attempts lack three reliable angle chains; side wrists and right-side limbs are excluded. Existing visibility gating is observed, not weakened.
12. **Calibration/body scale: calibration does not freeze scoring scale.** Accepted learner calibration begins at 1.668609 s and rewinds to zero. Normalization recomputes hip origin and body scale each frame; it does not read a stored calibration scale. Side median raw scale is 0.089577 versus front 0.154169. Shoulder-width/torso median is 0.123384 side versus 0.416419 front, and hip-width/torso is 0.078098 versus 0.247304. The width terms shrink under rotation and can amplify normalized leg distances. The respective median left-shin lengths are 2.245669 versus 1.055394 normalized units. This is projection-dependent scaling, not proven calibration failure.
13. **Cross-person/frame invariance: insufficient for these inputs.** Hip-centering and one scalar remove translation/uniform scale, not camera rotation, perspective, individual limb ratios or arbitrary arm styles. The teacher-reference defects must be isolated before assigning the entire failure to this representation.

### Diagnostic Files and Verification

Added diagnostic-only code: `src/scripts/level-b/generalizationDiagnostics.ts`, `diagnoseMovementGeneralization.ts`, `renderGeneralizationReport.mjs`, and `tests/unit/GeneralizationDiagnostics.test.ts`. This section is the only document modification for the investigation. `tests/e2e/teach-fixture.spec.ts` also gains test-only waits for asynchronous review-stage readiness; no application behavior or acceptance assertion changed. No proposed production fix was implemented.

All empirical outputs are under `test-results/movement/generalization/`: immutable input copies, provenance and production manifests, annotations/contact sheets, eleven full JSON/CSV matrices, per-frame JSON/NDJSON, barrier and difficulty replay, ablations, negative regions, teacher self/anchor audit, joint distributions, canonical realism, normalization features/control, summary, interactive `report.html`, desktop/mobile screenshots, report verification and regression logs. Heatmap colors use unrounded similarities; displayed numbers are rounded, raw matrix JSON retains full precision and CSV twelve significant digits. These ignored local artifacts are not committed automatically.

Reproduce diagnostics with `node --import tsx src/scripts/level-b/diagnoseMovementGeneralization.ts`; render/verify with `node src/scripts/level-b/renderGeneralizationReport.mjs`. These commands prefer the preserved `accepted-baseline` recordings, assert per-frame progress parity and unchanged production hashes, and never substitute new VIDEO-regression poses into the original diagnosis. The report works directly as an HTML file without another dev server.

Final verification: **114/114 unit, 11/11 ordinary E2E, 8/8 Level B, 2/2 movement tests**, total **135 passing executions**, zero final failures/skips. Typechecks, lint (zero errors, three pre-existing warnings), frontend/backend builds and report desktop/mobile verification passed. The heatmap contains 446,424 nonblank pixels and 726 distinct colors; both selector and matrix selection work without JS errors or mobile horizontal overflow. All eleven matrix dimensions were independently checked. `production-integrity-final.json` confirms all 146 hashed production/config files are unchanged.

The eight new diagnostic tests cover exact distance accounting, unchanged baseline comparison, missing apex, ordering/no wrap, explicitly permissive same-frame coverage, mirror immutability, missing reliable angles and actual tracker replay parity. Fresh VIDEO regression at 20/50/75/80/100 again yields zero reps and 20.370370% at every level, with **532/533/533/533/534** frames and 14 corrections each. Teacher cycle/sequence cache checks pass without fabricating a learner dance clip. Fresh results are copied into `fresh-video-regression`; original five-difficulty recordings are separately preserved in `accepted-baseline`.

The upload UI regression again verifies zero `getUserMedia` calls, exactly one automatic EOF evaluation without Finish, matching calibration/run/evaluation IDs, rendered pose pixels and paused media after completion. The unchanged Level B fake-webcam test records one rep in 61 frames, one coaching correction, acquisitions/releases 2/2 and pose starts/stops 3/3; no physical-webcam claim is made.

Earlier failures remain preserved: initial sandbox verification could not access esbuild's workspace/config resolution; initial sandbox E2E had eleven Chromium `spawn EPERM` launch failures, resolved by approved execution. Two approved ordinary E2E runs had one genuine harness timeout each: the test checked for capture/debrief/teach-back synchronously while the reused server was using asynchronous live-service question generation. The first readiness fix exposed the same race at the final debrief-to-teach-back transition; the final test synchronizes each transition and keeps all existing assertions. Both failure logs and contexts remain alongside the final all-green logs. No matching threshold, required test count or product behavior was weakened. Verification totals and references are also in `verification-summary.json`.
