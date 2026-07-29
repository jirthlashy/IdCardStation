import { execFile } from "node:child_process";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "../../..");
const repoRoot = path.resolve(workspaceRoot, "..");

const sourceRoot = scriptDir;
const sourceSupport = path.join(sourceRoot, "support");
const liteSource = path.join(sourceRoot, "lite");
const fullTargetRoot = path.join(repoRoot, "deploy-transfer", "reader-agent");
const liteTargetRoot = path.join(repoRoot, "deploy-transfer-lite", "reader-agent");

const supportScripts = [
  "THAI_ID_READER_LAUNCHER.ps1",
  "RUN_READER_AGENT_BACKGROUND.ps1",
  "STOP_READER_AGENT.ps1",
];

const obsoleteRootFiles = [
  "reader.env",
  "THAI_ID_READER_LAUNCHER.ps1",
  "RUN_READER_AGENT_BACKGROUND.ps1",
  "STOP_READER_AGENT.ps1",
  "START_READER_AGENT.ps1",
  "Start Reader Agent.bat",
  "Stop Reader Agent.bat",
];

async function assertDirectory(directoryPath) {
  const info = await stat(directoryPath);
  if (!info.isDirectory()) {
    throw new Error(`Expected directory: ${directoryPath}`);
  }
}

await assertDirectory(sourceRoot);
await assertDirectory(sourceSupport);
await assertDirectory(liteSource);
await assertDirectory(fullTargetRoot);
await assertDirectory(liteTargetRoot);

async function syncCommonLauncher(targetRoot) {
  const targetSupport = path.join(targetRoot, ".reader-support");
  await mkdir(targetSupport, { recursive: true });

  await copyFile(
    path.join(sourceRoot, "Thai ID Reader.bat"),
    path.join(targetRoot, "Thai ID Reader.bat"),
  );

  for (const scriptName of supportScripts) {
    await copyFile(path.join(sourceSupport, scriptName), path.join(targetSupport, scriptName));
  }

  for (const fileName of obsoleteRootFiles) {
    await rm(path.join(targetRoot, fileName), { force: true });
  }

  if (process.platform === "win32") {
    await execFileAsync("attrib", ["+h", targetSupport]);
  }

  return targetSupport;
}

const fullTargetSupport = await syncCommonLauncher(fullTargetRoot);
await rm(path.join(fullTargetSupport, "INSTALL_READER.ps1"), { force: true });

const liteTargetSupport = await syncCommonLauncher(liteTargetRoot);
await copyFile(
  path.join(liteSource, "INSTALL_READER.ps1"),
  path.join(liteTargetSupport, "INSTALL_READER.ps1"),
);

if (process.platform === "win32") {
  await execFileAsync("attrib", ["+h", liteTargetSupport]);
}

console.log(`Synced full and lite Windows reader launchers from ${sourceRoot}`);
