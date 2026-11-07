# MediaPipe Pose Assets

The active movement model is the official Pose Landmarker Heavy float16/version-1 task:

- Source: https://storage.googleapis.com/mediapipe-models/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task
- File: `pose_landmarker_heavy.task`, 30,664,242 bytes.
- SHA256: `64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b`.
- Model documentation: [BlazePose GHUM 3D model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf).

The official model card identifies Apache-2.0 licensing. Retain its documented single-person and inferred/non-metric depth limitations. This notice does not assert broader training-dataset rights or suitability for safety-critical decisions.

Local `wasm/` assets are copied from the locked `@mediapipe/tasks-vision` npm dependency by `npm run prepare:pose`. Its package license remains in `node_modules/@mediapipe/tasks-vision`; the shipped runtime uses the same package version rather than a remote CDN. The [official web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js) documents VIDEO mode for both decoded videos and camera streams.

The Full task remains solely for legacy 2D lessons. RTMW3D checkpoint rights and optional compatibility setup are documented separately in `docs/RTMW3D_MODEL.md`; RTMW3D is not required by new lessons.
