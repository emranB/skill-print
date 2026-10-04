import type { TeachingMedia } from "./media.types";

export interface MediaSource {
  kind: TeachingMedia["source"];
  produce(): Promise<TeachingMedia>;
}
