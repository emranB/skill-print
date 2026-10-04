import { describe, expect, it } from "vitest";
import { RateLimiter } from "../../src/backend/middleware/rateLimit";

const rule = { name: "test", limit: 3, windowMs: 1000 };

describe("RateLimiter", () => {
  it("allows up to the limit per client, then reports the wait until reset", () => {
    let t = 0;
    const limiter = new RateLimiter(() => t);
    expect([1, 2, 3].map(() => limiter.hit(rule, "a"))).toEqual([0, 0, 0]);
    t = 400;
    expect(limiter.hit(rule, "a")).toBe(600);
    expect(limiter.hit(rule, "b")).toBe(0);
    expect(limiter.hit({ ...rule, name: "other" }, "a")).toBe(0);
    t = 1000;
    expect(limiter.hit(rule, "a")).toBe(0);
  });

  it("drops expired buckets so memory stays bounded", () => {
    let t = 0;
    const limiter = new RateLimiter(() => t);
    for (let i = 0; i < 50; i += 1) limiter.hit(rule, `client-${i}`);
    expect(limiter.size()).toBe(50);
    t = 5000;
    limiter.sweep();
    expect(limiter.size()).toBe(0);
  });
});
