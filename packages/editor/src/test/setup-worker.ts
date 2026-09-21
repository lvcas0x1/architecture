import { createRequire } from "node:module";
import { vi } from "vitest";

// jsdom has no Web Worker. Keep ELK's real layout engine in unit tests using
// its shipped in-process worker; browser builds use the dedicated worker URL.
const require = createRequire(import.meta.url);
const { Worker } = require("elkjs/lib/elk-worker.min.js");
vi.stubGlobal("Worker", Worker);
