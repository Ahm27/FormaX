import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const dbPath = path.join(projectRoot, "pharmacy.db");
const distIndex = path.join(projectRoot, "dist", "index.html");

function run(command, args) {
  execFileSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
  });
}

function checkDatabase() {
  if (!fs.existsSync(dbPath)) {
    throw new Error("Missing pharmacy.db");
  }

  const db = new Database(dbPath, { readonly: true });
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);

  if (!tables.includes("clients") || !tables.includes("followups")) {
    throw new Error("Database is missing clients/followups tables");
  }

  const totals = {
    clients: db.prepare("SELECT COUNT(*) AS count FROM clients").get().count,
    followups: db.prepare("SELECT COUNT(*) AS count FROM followups").get().count,
  };

  db.close();
  return totals;
}

function main() {
  console.log("Checking database...");
  const totals = checkDatabase();

  console.log("Checking backend syntax...");
  run("node", ["--check", "backend/server.js"]);

  console.log("Building frontend...");
  run("npm", ["run", "build"]);

  if (!fs.existsSync(distIndex)) {
    throw new Error("Build finished but dist/index.html is missing");
  }

  console.log("");
  console.log("Delivery check passed.");
  console.log(`Clients: ${totals.clients}`);
  console.log(`Follow-ups: ${totals.followups}`);
  console.log("Next step: run `npm start` or use the .command launcher.");
}

main();
