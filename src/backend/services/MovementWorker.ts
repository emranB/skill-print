import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

/** Bounded RPC queue; a single worker owns the model and causal run state. */
class MovementWorker {
  constructor() { process.once("exit", () => this.child?.kill()); }
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  private start() {
    if (this.child) return;
    const local = process.platform === "win32" ? ".venv-movement/Scripts/python.exe" : ".venv-movement/bin/python";
    const python = process.env.SKILLPRINT_MOVEMENT_PYTHON ?? (existsSync(local) ? path.resolve(local) : "python3");
    const child = spawn(python, ["-u", "src/movement/worker.py"], { windowsHide: true, stdio: "pipe" });
    this.child = child;
    createInterface({ input: child.stdout }).on("line", (line: string) => {
      try {
        const reply = JSON.parse(line) as { id: number; result?: unknown; error?: string };
        const pending = this.pending.get(reply.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(reply.id);
        if (reply.error) pending.reject(new Error(reply.error));
        else pending.resolve(reply.result);
      } catch { console.error("Invalid movement worker response"); }
    });
    child.stderr.on("data", (data: Buffer) => console.error(data.toString().trim()));
    const failed = (error: Error) => {
      if (this.child !== child) return;
      this.child = null;
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
      this.pending.clear();
    };
    child.on("error", failed);
    child.on("exit", () => failed(new Error("Movement worker exited; restart your attempt")));
  }

  call(request: Record<string, unknown>): Promise<unknown> {
    if (this.pending.size >= 64) return Promise.reject(new Error("Movement worker busy"));
    this.start();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Movement worker timeout")); }, 120_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ ...request, id }) + "\n", (error) => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }
}

export const movementWorker = new MovementWorker();
