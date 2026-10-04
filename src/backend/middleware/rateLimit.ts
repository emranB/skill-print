import type { NextFunction, Request, RequestHandler, Response } from "express";

export interface RateLimitRule {
  /** Route class name, used in the bucket key and logs. */
  name: string;
  limit: number;
  windowMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Upper bound on tracked client buckets; oldest are evicted first. */
const MAX_BUCKETS = 10_000;

/**
 * Fixed-window per-client limiter held in memory.
 *
 * The client key is `req.ip`, which is the socket address unless Express
 * `trust proxy` is configured, so spoofed forwarding headers are ignored by default.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Returns 0 when allowed, otherwise milliseconds until the window resets. */
  hit(rule: RateLimitRule, client: string): number {
    const key = `${rule.name}|${client}`;
    const t = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= t) {
      this.buckets.delete(key);
      bucket = { count: 0, resetAt: t + rule.windowMs };
      this.buckets.set(key, bucket);
      this.evictOverflow();
    }
    bucket.count += 1;
    return bucket.count > rule.limit ? bucket.resetAt - t : 0;
  }

  /** Drop expired buckets. */
  sweep(): void {
    const t = this.now();
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= t) this.buckets.delete(key);
  }

  size(): number {
    return this.buckets.size;
  }

  private evictOverflow(): void {
    while (this.buckets.size > MAX_BUCKETS) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) return;
      this.buckets.delete(oldest);
    }
  }

  middleware(rule: RateLimitRule): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      const client = req.ip ?? req.socket.remoteAddress ?? "unknown";
      const waitMs = this.hit(rule, client);
      if (waitMs === 0) {
        next();
        return;
      }
      const retryAfterSec = Math.max(1, Math.ceil(waitMs / 1000));
      console.warn(`[rate-limit] ${rule.name} limited for ${client}, retry in ${retryAfterSec}s`);
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({
        error: "RATE_LIMITED",
        message: `Too many requests. Try again in ${retryAfterSec} s.`,
        retryAfterSec,
      });
    };
  }
}

/**
 * Generous enough for repeated demo runs: one Teach makes about 5 structured
 * calls and 1 transcription; voice reconnects each mint a session.
 */
export const RATE_LIMITS = {
  structured: { name: "apprentice-structured", limit: 40, windowMs: 60_000 },
  session: { name: "elevenlabs-session", limit: 20, windowMs: 60_000 },
  transcribe: { name: "transcribe", limit: 10, windowMs: 60_000 },
} satisfies Record<string, RateLimitRule>;
