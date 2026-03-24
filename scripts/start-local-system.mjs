import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distIndex = path.join(projectRoot, "dist", "index.html");
const viteBin = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
const frontendUrl = "http://127.0.0.1:4173";
const backendUrl = "http://127.0.0.1:3001";
const nodeExec = process.execPath;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      shell: false,
      ...options,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function spawnLongRunning(command, args, label) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false,
  });

  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`${label} stopped with code ${code}.`);
    }
  });

  return child;
}

async function openBrowser(url) {
  const platform = process.platform;
  const opener =
    platform === "darwin" ? ["open", [url]] : platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];

  try {
    const child = spawn(opener[0], opener[1], {
      cwd: projectRoot,
      stdio: "ignore",
      detached: true,
    });
    child.unref();
  } catch {}
}

async function main() {
  if (!fs.existsSync(distIndex)) {
    console.log("No production build found. Building now...");
    await run(nodeExec, [viteBin, "build"]);
  }

  const backend = spawnLongRunning(nodeExec, ["backend/server.js"], "Backend");
  const frontend = spawnLongRunning(nodeExec, ["scripts/serve-static.mjs"], "Frontend");

  const shutdown = () => {
    backend.kill("SIGTERM");
    frontend.kill("SIGTERM");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("");
  console.log("Dr. Sherin Pharmacy is starting...");
  console.log(`Frontend: ${frontendUrl}`);
  console.log(`Backend:  ${backendUrl}`);
  console.log("Press Ctrl+C to stop both services.");

  setTimeout(() => {
    void openBrowser(frontendUrl);
  }, 1500);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
