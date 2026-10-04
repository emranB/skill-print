import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");

dotenv.config({ path: path.join(root, ".env") });

export interface ServerEnv {
  port: number;
  elevenLabsApiKey: string | undefined;
  elevenLabsAgentId: string | undefined;
  isProduction: boolean;
  rootDir: string;
  /** Forces the browser's default apprentice mode; automated suites set "mock" to stay offline. */
  apprenticeDefault: "mock" | "elevenlabs" | undefined;
}

export function loadEnv(): ServerEnv {
  const port = Number(process.env.PORT ?? "8000");
  const forced = process.env.SKILLPRINT_APPRENTICE_DEFAULT;
  return {
    apprenticeDefault: forced === "mock" || forced === "elevenlabs" ? forced : undefined,
    port: Number.isFinite(port) ? port : 8000,
    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || undefined,
    elevenLabsAgentId: process.env.ELEVENLABS_AGENT_ID || undefined,
    isProduction: process.env.NODE_ENV === "production",
    rootDir: root,
  };
}
