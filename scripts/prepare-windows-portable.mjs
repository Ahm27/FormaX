import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const releaseRoot = path.join(projectRoot, "release", "windows-portable");
const runtimeDir = path.join(releaseRoot, "runtime");
const nodeSource = process.execPath;
const viteBin = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");

if (process.platform !== "win32") {
  console.error("This script must be run on Windows to produce a real Windows portable package.");
  process.exit(1);
}

function removeIfExists(targetPath) {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function copyIfExists(source, destination) {
  if (fs.existsSync(source)) {
    fs.cpSync(source, destination, { recursive: true });
  }
}

console.log("Building frontend...");
execFileSync(nodeSource, [viteBin, "build"], {
  cwd: projectRoot,
  stdio: "inherit",
});

console.log("Preparing release folder...");
removeIfExists(releaseRoot);
fs.mkdirSync(releaseRoot, { recursive: true });
fs.mkdirSync(runtimeDir, { recursive: true });

const foldersToCopy = [
  "backend",
  "dist",
  "docs",
  "node_modules",
  "public",
  "scripts",
  "src",
  "sync-data",
  "backups",
];

for (const folder of foldersToCopy) {
  copyIfExists(path.join(projectRoot, folder), path.join(releaseRoot, folder));
}

const filesToCopy = [
  "package.json",
  "package-lock.json",
  "pharmacy.db",
  "index.html",
  "vite.config.ts",
  "postcss.config.mjs",
  "README.md",
];

for (const file of filesToCopy) {
  const source = path.join(projectRoot, file);
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(releaseRoot, file));
  }
}

fs.copyFileSync(nodeSource, path.join(runtimeDir, "node.exe"));

const portableLauncher = `@echo off
cd /d "%~dp0"
"%~dp0runtime\\node.exe" scripts\\start-local-system.mjs
pause
`;
fs.writeFileSync(
  path.join(releaseRoot, "Start Dr Sherin Pharmacy Portable.bat"),
  portableLauncher,
  "utf8"
);

console.log("");
console.log("Windows portable package created:");
console.log(releaseRoot);
console.log("");
console.log("Give the whole `windows-portable` folder to the client.");
