// Lets the benchmark import src/lib/scoring/jev.ts from plain Node.
// Next resolves the marker package "server-only". This process is not a client bundle.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const empty = fileURLToPath(new URL("../node_modules/next/dist/compiled/server-only/empty.js", import.meta.url));
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "server-only") return empty;
  return resolve.call(this, request, parent, isMain, options);
};
