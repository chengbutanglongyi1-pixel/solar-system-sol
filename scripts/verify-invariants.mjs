// Static checks against the published simulation source.
// Confirms embedded map bytes, routing anchors, and the PC simple-shader lock.
// This does not decode images, render pixels, or exercise a phone.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "src/SolarSystemApp.tsx");
const source = fs.readFileSync(sourcePath, "utf8");
const expected = JSON.parse(fs.readFileSync(path.join(root, "scripts/expected-maps.json"), "utf8"));

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

const maps = {};
const officialLine = source.split("\n").find((line) => line.startsWith("const SOL_OFFICIAL_EUROPA_MAP"));
assert.ok(officialLine, "official Europa map missing");
const officialParts = [...officialLine.slice(officialLine.indexOf("=") + 1).matchAll(/"([^"]*)"/g)].map((m) => m[1]);
const officialRaw = Buffer.from(officialParts.join("").slice("data:image/webp;base64,".length), "base64");
maps["official:europa-warm"] = { sha256: sha256(officialRaw), bytes: officialRaw.length };

const pc = source.slice(source.indexOf("const SOL_PC_PREBAKED_MAPS"), source.indexOf("const FRAG_SRC_SIMPLE"));
for (const match of pc.matchAll(/^  "([^"]+)": "data:image\/webp;base64,([^"]+)"/gm)) {
  const raw = Buffer.from(match[2], "base64");
  maps["pc:" + match[1]] = { sha256: sha256(raw), bytes: raw.length };
}

assert.equal(Object.keys(maps).length, 21);
assert.deepEqual(maps, expected);
assert.equal(maps["official:europa-warm"].sha256, "2dbee40971d522d482703e407e06d970dd6e52750422b3e15ac8c5350813ebcf");
assert.equal(maps["pc:europa"].sha256, "86b084887de1f177c121bfdf35023b634b3934119bfc9be393d636615a3882eb");

for (const token of [
  "const USE_PER_BODY_PROGS = false",
  "let usePerBodyAsync = false",
  "let upgradeStopped = true",
  "let upgradeStarted = true",
  "const solarLiteBoot = embeddedBoot || previewish || !isMobileUA;",
  "solarLiteBoot && !isMobileUA",
  "? [() => FRAG_SRC_SIMPLE]",
  "selectSurface(it.id, gs, cx, cy, focal, pxR);",
  "gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);\n        recordSurfaceDraw(it.id);",
  "if (isMobileUA) { bindSurfacePlan(plan); return; }",
  "surfaceEvents.length > 80",
  "surfaceHost.__solarSurfaceDiagnostics = surfaceDiagnostic",
  'pending: "有意待同步：手机暖官图尚待美术验收；电脑保留旧预画，不是漏更新"',
  'mobile: { source: "official-map", resource: "official:europa-warm"',
  'pc: { source: "pc-prebaked", resource: "pc:europa"',
  "const ELEMENTS: Record<string, number[]>",
  "const ROT_IAU: Record<string, [number, number]>",
  "function lockPoleOf(",
  "function moonRelAt(",
  "const VIS: Record<string, Vis>",
]) {
  assert.ok(source.replace(/\r\n/g, "\n").includes(token), "missing protected text: " + token);
}

assert.equal(source.includes("if (!isMobileUA) selectSurface(it.id"), false);
assert.equal(source.includes("if (isMobileUA) requestMobileEuropaMap();"), false);
const registry = source.slice(source.indexOf("// SURFACE_REGISTRY_BEGIN"), source.indexOf("// SURFACE_REGISTRY_END"));
assert.equal(registry.includes("getFullFrag("), false);
assert.equal(source.includes('from "grok/canvas"'), false);
assert.equal(source.includes('from "./host"'), true);

const forbidden = ["/home/", "/Users/", "cursor.com/agents", "x-access-token", "BEGIN OPENSSH", "BEGIN PRIVATE"];
for (const rel of ["src/SolarSystemApp.tsx", "src/host.tsx", "src/main.tsx", "README.md", ".github/workflows/pages.yml"]) {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  for (const item of forbidden) assert.equal(text.includes(item), false, rel + " contains " + item);
}

const report = {
  type: "static/source invariants; NOT browser, GPU pixels, or a phone",
  pass: true,
  mapCount: 21,
  maps,
};
fs.writeFileSync(path.join(root, "scripts/invariants-result.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ pass: true, mapCount: 21, officialEuropa: maps["official:europa-warm"].sha256, pcEuropa: maps["pc:europa"].sha256 }));
