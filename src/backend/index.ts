import express from "express";
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./config/env.js";
import { RATE_LIMITS, RateLimiter } from "./middleware/rateLimit.js";
import { apprenticeRouter } from "./routes/apprentice.js";
import { configRouter } from "./routes/config.js";
import { elevenLabsRouter } from "./routes/elevenlabs.js";
import { healthRouter } from "./routes/health.js";
import { lessonsRouter } from "./routes/lessons.js";
import { transcribeRouter } from "./routes/transcribe.js";

const env = loadEnv();
const app = express();
const limiter = new RateLimiter();
setInterval(() => limiter.sweep(), 60_000).unref();

// Forwarded client addresses are only honoured when a proxy is explicitly configured.
if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY);

app.use("/api/apprentice/structured", limiter.middleware(RATE_LIMITS.structured));
app.use("/api/elevenlabs/session", limiter.middleware(RATE_LIMITS.session));
app.use("/api/transcribe", limiter.middleware(RATE_LIMITS.transcribe));
app.use(express.json({ limit: "25mb" }));

app.use("/api", healthRouter);
app.use("/api", lessonsRouter);
app.use("/api", configRouter);
app.use("/api", transcribeRouter);
app.use("/api", elevenLabsRouter);
app.use("/api", apprenticeRouter);

const clientDir = path.join(env.rootDir, "dist/client");
if (env.isProduction && fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDir, "index.html"));
  });
}

app.listen(env.port, () => {
  console.log(`SkillPrint server listening on ${env.port}`);
});
