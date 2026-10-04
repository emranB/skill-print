import { useObjectUrl } from "../media/useObjectUrl";
import { DebugBus } from "../debug/DebugBus";

interface Props {
  video?: Blob | null;
  baseName?: string;
}

function extensionFor(type: string): string {
  if (type.includes("mp4")) return "mp4";
  if (type.includes("quicktime")) return "mov";
  return "webm";
}

function fileName(video: Blob, baseName: string): string {
  if (video instanceof File && video.name) return video.name;
  const slug = baseName.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "teaching";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `skillprint-${slug}-${stamp}.${extensionFor(video.type)}`;
}

/** Lets the expert keep a copy of the teaching video before the lesson is submitted. */
export function RecordingDownload({ video, baseName = "teaching" }: Props) {
  const url = useObjectUrl(video && video.size > 0 ? video : null);
  if (!video || !url) return null;
  const name = fileName(video, baseName);
  return (
    <a
      className="button-link secondary"
      href={url}
      download={name}
      data-testid="download-recording"
      onClick={() =>
        DebugBus.emit({ category: "MEDIA", event: "RECORDING_DOWNLOADED", data: { bytes: video.size, type: video.type } })
      }
    >
      Download video ({(video.size / 1_048_576).toFixed(1)} MB)
    </a>
  );
}
