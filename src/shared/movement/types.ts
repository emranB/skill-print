export type Vector3 = [number, number, number];

export interface BodySkeleton {
  representation: "rtmw3d-body-v1";
  checkpoint: string;
  joints: Vector3[];
  confidence: number[];
  bones: Vector3[];
  boneConfidence: number[];
  depthConfidence: number[];
  orientationReliable: boolean;
  root: Vector3;
  scale: number;
  basis: Vector3[];
  cameraAssumption: string;
  imageSize?: [number, number];
}
