import type { SessionClock, SessionTimeMs } from "./clock.types";

export class RealSessionClock implements SessionClock {
  private startMonotonic: number | null = null;
  private running = false;

  start(): void {
    this.startMonotonic = performance.now();
    this.running = true;
  }

  now(): SessionTimeMs {
    if (this.startMonotonic === null) return 0;
    return performance.now() - this.startMonotonic;
  }

  isRunning(): boolean {
    return this.running;
  }

  stop(): void {
    this.running = false;
  }

  reset(): void {
    this.startMonotonic = null;
    this.running = false;
  }
}

export class FakeSessionClock implements SessionClock {
  private current = 0;
  private running = false;

  start(): void {
    this.running = true;
  }

  now(): SessionTimeMs {
    return this.current;
  }

  set(ms: SessionTimeMs): void {
    this.current = ms;
  }

  advance(ms: SessionTimeMs): void {
    this.current += ms;
  }

  isRunning(): boolean {
    return this.running;
  }

  stop(): void {
    this.running = false;
  }

  reset(): void {
    this.current = 0;
    this.running = false;
  }
}
