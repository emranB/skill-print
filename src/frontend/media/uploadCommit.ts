type CommitHandler = () => void;

let handler: CommitHandler | null = null;

/** TeachFlow registers this while the upload recording step is on screen. */
export function onUploadCommit(next: CommitHandler | null): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

export function commitUpload(): boolean {
  if (!handler) return false;
  handler();
  return true;
}
