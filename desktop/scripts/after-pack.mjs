// Puts what "On this computer" runs next to the packed app, in its resources
// folder. By hand, because electron-builder's extraResources quietly leaves out
// every node_modules folder. It comes from scripts/prepare-server.mjs, which has
// already checked it.

import { cpSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const bundle = path.join(import.meta.dirname, "..", "build-server");

export default async function afterPack({ appOutDir, electronPlatformName, packager, arch }) {
  if (!existsSync(path.join(bundle, "server", "server.js"))) throw new Error("There's no server to pack. Run scripts/prepare-server.mjs first.");
  const expectedArch = arch === 3 ? "arm64" : arch === 1 ? "x64" : undefined;
  if (electronPlatformName === "darwin" && !expectedArch) throw new Error(`Unsupported macOS Electron architecture: ${arch}.`);
  const preparedArch = readFileSync(path.join(bundle, "runtime-arch"), "utf8").trim();
  if (electronPlatformName === "darwin" && preparedArch !== expectedArch) {
    throw new Error(`Prepared server architecture ${preparedArch} does not match Electron architecture ${expectedArch}.`);
  }
  const resources = electronPlatformName === "darwin"
    ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : path.join(appOutDir, "resources");
  cpSync(bundle, resources, { recursive: true });
}
