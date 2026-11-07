import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const model=await readFile(path.join(root,"public/models/pose_landmarker_heavy.task"));
const hash=createHash("sha256").update(model).digest("hex");
if(hash!=="64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b") throw new Error("Unexpected Heavy model asset; check provenance before building");
const source=path.join(root,"node_modules/@mediapipe/tasks-vision/wasm"),destination=path.join(root,"public/models/wasm");
await mkdir(destination,{recursive:true});
for(const file of await readdir(source)) if(file.endsWith(".wasm") || file.endsWith(".js")) await copyFile(path.join(source,file),path.join(destination,file));
console.log(`Prepared local MediaPipe WASM and verified Heavy SHA256 ${hash}`);
