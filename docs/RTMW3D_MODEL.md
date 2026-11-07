# RTMW3D Model Provenance

Recorded before downloading or integrating weights, 2026-10-04.

Downloaded ONNX artifact SHA-256: `4a289c0e99d47eb595e99679d9d4a2d1def1b4241f9adcbafba44b9ff585ebcd`. Runtime verifies it against the explicit installation provenance. This is an integrity check, not an independent license grant or proof of numerical equivalence to the official PyTorch checkpoint.

- Architecture: MMPose RTMW3D-X, COCO-WholeBody 133 joints, 384 x 288 input.
- Official checkpoint: `rtmw3d-x_8xb64_cocktail14-384x288-b0a0eab7_20240626.pth`.
- Official model zoo: https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose3d
- Official weights: https://download.openmmlab.com/mmpose/v1/wholebody_3d_keypoint/rtmw3d/rtmw3d-x_8xb64_cocktail14-384x288-b0a0eab7_20240626.pth
- Deployment artifact: the ONNX conversion referenced by RTMLib's Wholebody3d implementation, https://huggingface.co/Soykaf/RTMW3D-x/resolve/main/onnx/rtmw3d-x_8xb64_cocktail14-384x288-b0a0eab7_20240626.onnx
- Conversion provenance: third-party Soykaf conversion, not an official OpenMMLab export. Its model card declares Apache-2.0. This declaration is not proof that all original weight/training-data rights permit commercial deployment. Artifact SHA-256 is recorded by the installer.
- MMPose source: Apache-2.0. RTMLib source: Apache-2.0. DTAIDistance source: Apache-2.0. These source licenses are distinct from pretrained-weight rights.
- Training provenance: cocktail14 configuration and RTMW paper; configuration includes COCO-WholeBody, Halpe, AIC, CrowdPose, MPII, JHMDB, PoseTrack, WFLW, 300W, COFW, LaPa, InterHand2.6M, UBody and H3WB/Human3.6M. Dataset permissions vary and are not reassigned by this repository. HumanArt is commented out in the body training configuration.
- Original checkpoint-specific licensing: not independently resolved by the upstream model zoo. Commercial release is blocked pending weight/data rights review. Installation requires an explicit acknowledgement of this unresolved status; weights are not redistributed with SkillPrint.

No substitute pose/motion network is used. The application remains single-person: a user-supplied full-body frame/crop is the RTMW3D top-down input. No additional detector weights are downloaded.

RTMW3D emits image-plane x/y plus root-relative depth, not metric XYZ directly. The adapter applies the upstream camera reconstruction (documented default focal lengths and root depth), then body-centric normalization. Camera assumptions are recorded in each skeleton; uncalibrated depth and viewpoint errors remain empirical limitations, not ground-truth measurements.

## Sources

- https://github.com/open-mmlab/mmpose/blob/main/projects/rtmpose3d/configs/rtmw3d-x_8xb32_cocktail14-384x288.py
- https://arxiv.org/abs/2407.08634
- https://huggingface.co/Soykaf/RTMW3D-x/blob/main/README.md
- https://github.com/Tau-J/rtmlib/blob/main/rtmlib/tools/solution/wholebody3d.py
- https://github.com/open-mmlab/mmpose/blob/main/projects/rtmpose3d/rtmpose3d/pose_estimator.py
