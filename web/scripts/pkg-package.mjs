/**
 * After `npx pkg` builds the binary, this script creates a distributable zip
 * containing the binary + the dist/ folder (which must live alongside the exe).
 *
 * Usage: node scripts/pkg-package.mjs [win|mac]
 */
import { execSync } from "child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const platform = process.argv[2] ?? "win";

const outDir = join(root, "release", "pkg");
const binName = platform === "win" ? "jInvoice.exe" : "jInvoice-mac";
const zipName = platform === "win" ? "jInvoice-windows.zip" : "jInvoice-mac.zip";
const stageDir = join(outDir, "stage");

// Stage: binary + dist/
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(join(stageDir, "dist"), { recursive: true });
cpSync(join(outDir, binName), join(stageDir, binName));
cpSync(join(root, "dist"), join(stageDir, "dist"), { recursive: true });

// Windows: add a launcher batch file so errors stay visible
if (platform === "win") {
  writeFileSync(join(stageDir, "Start jInvoice.bat"), [
    "@echo off",
    "title jInvoice",
    "cd /d \"%~dp0\"",
    "echo Starting jInvoice...",
    "echo.",
    "jInvoice.exe",
    "echo.",
    "echo jInvoice stopped. If you see an error above, press any key.",
    "pause > nul",
  ].join("\r\n"));
}

// On Windows, GitHub Actions upload-artifact already zips the folder,
// so skip creating our own zip to avoid a zip-inside-zip.
if (process.platform !== "win32") {
  const zipPath = join(outDir, zipName);
  execSync(`cd "${stageDir}" && zip -r "${zipPath}" .`, { stdio: "inherit" });
  rmSync(stageDir, { recursive: true });
  console.log(`\nDone! Distributable: release/pkg/${zipName}`);
  console.log("Users: unzip, then double-click the binary to launch jInvoice in their browser.");
} else {
  console.log(`\nDone! Staged files in: release/pkg/stage/`);
  console.log("Users: unzip the downloaded artifact, then double-click 'Start jInvoice.bat'.");
}
