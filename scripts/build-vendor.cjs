/**
 * 生成本地 vendor（无外网可用）：npm install && npm run vendor
 */
const path = require("path");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "paiZhouUtil", "vendor");

async function main() {
  await esbuild.build({
    entryPoints: [path.join(__dirname, "vendor-entries", "qrcode-entry.js")],
    bundle: true,
    platform: "browser",
    format: "iife",
    outfile: path.join(outDir, "qrcode.bundle.js"),
    logLevel: "info",
  });
  await esbuild.build({
    entryPoints: [path.join(__dirname, "vendor-entries", "jsqr-entry.js")],
    bundle: true,
    platform: "browser",
    format: "iife",
    outfile: path.join(outDir, "jsqr.bundle.js"),
    logLevel: "info",
  });
  console.log("OK:", path.join(outDir, "qrcode.bundle.js"), path.join(outDir, "jsqr.bundle.js"));
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
