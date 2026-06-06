import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import pngToIco from "png-to-ico";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const buildDir = path.join(projectRoot, "build");
const trackedIconsDir = path.join(projectRoot, "public", "desktop-icons");
const fallbackIcns = path.join(trackedIconsDir, "icon.icns");
const fallbackIco = path.join(trackedIconsDir, "icon.ico");
const fallbackPng = path.join(trackedIconsDir, "icon.png");
const sourceIcns = fs.existsSync(fallbackIcns)
  ? fallbackIcns
  : path.join(projectRoot, "Dr Sherin Pharmacy.app", "Contents", "Resources", "AppIcon.icns");
const outputIcns = path.join(buildDir, "icon.icns");
const outputPng = path.join(buildDir, "icon.png");
const outputIco = path.join(buildDir, "icon.ico");

if (!fs.existsSync(sourceIcns)) {
  console.error(`Missing source icon: ${sourceIcns}`);
  process.exit(1);
}

fs.mkdirSync(buildDir, { recursive: true });
fs.copyFileSync(sourceIcns, outputIcns);

if (fs.existsSync(fallbackPng)) {
  fs.copyFileSync(fallbackPng, outputPng);
} else {
  execFileSync("sips", ["-s", "format", "png", sourceIcns, "--out", outputPng], {
    cwd: projectRoot,
    stdio: "ignore",
  });
}

if (fs.existsSync(fallbackIco)) {
  fs.copyFileSync(fallbackIco, outputIco);
} else {
  const icoBuffer = await pngToIco(outputPng);
  fs.writeFileSync(outputIco, icoBuffer);
}

console.log("Electron icons generated:");
console.log(outputIcns);
console.log(outputPng);
console.log(outputIco);
