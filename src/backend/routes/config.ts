import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../config/env.js";

export const configRouter = Router();

configRouter.get("/config", (_req, res) => {
  const env = loadEnv();
  const configPath = path.join(env.rootDir, "config.json");
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw) as unknown;
    res.json(config);
  } catch (error) {
    res.status(500).json({
      error: "CONFIG_LOAD_FAILED",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});
