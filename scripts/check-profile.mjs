import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedDir = resolve(root, "assets/generated");
const readmePath = resolve(root, "README.md");
const dataPath = resolve(root, "content/profile.json");

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function isHttps(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function snapshot() {
  const files = (await readdir(generatedDir)).filter((name) => name.endsWith(".svg")).sort();
  const hashes = {};
  for (const file of files) {
    const content = await readFile(resolve(generatedDir, file));
    hashes[file] = createHash("sha256").update(content).digest("hex");
  }
  return hashes;
}

const profile = JSON.parse(await readFile(dataPath, "utf8"));
const readme = await readFile(readmePath, "utf8");

assert(profile.identity?.name === "Raúl Iglesias Julios", "identity.name is missing or unexpected");
assert(profile.chapter?.title && profile.chapter?.thread && profile.chapter?.state, "chapter is incomplete");
assert(profile.heroPortrait?.path, "heroPortrait.path is required");
assert(Array.isArray(profile.worlds) && profile.worlds.length === 6, "exactly six worlds are required");
assert(Array.isArray(profile.method?.stages) && profile.method.stages.length === 6, "method requires six stages");
assert(Array.isArray(profile.method?.disciplines) && profile.method.disciplines.length === 3, "method requires three disciplines");
assert(Array.isArray(profile.method?.principles) && profile.method.principles.length === 3, "method requires three principles");
assert(Array.isArray(profile.fieldNotes) && profile.fieldNotes.length === 3, "three field notes are required");
assert(Array.isArray(profile.inventory) && profile.inventory.length === 4, "inventory requires four branches");

const ids = new Set();
const slugs = new Set();
for (const world of profile.worlds) {
  assert(/^0[1-6]$/.test(world.id), `invalid world id: ${world.id}`);
  assert(!ids.has(world.id), `duplicate world id: ${world.id}`);
  assert(!slugs.has(world.slug), `duplicate world slug: ${world.slug}`);
  ids.add(world.id);
  slugs.add(world.slug);
  assert(world.title && world.discipline && world.summary && world.visitor, `world ${world.id} is missing narrative content`);
  assert(Array.isArray(world.decisions) && world.decisions.length === 3, `world ${world.id} requires three decisions`);
  assert(["case-study", "live-only"].includes(world.evidence?.kind), `world ${world.id} has invalid evidence.kind`);
  assert(isHttps(world.evidence.live), `world ${world.id} requires an HTTPS live link`);
  if (world.evidence.kind === "case-study") {
    assert(isHttps(world.evidence.caseStudy), `world ${world.id} requires an HTTPS case study link`);
    assert(!world.evidence.portfolio, `world ${world.id} should not mix case-study and portfolio evidence`);
  } else {
    assert(isHttps(world.evidence.portfolio), `world ${world.id} requires an HTTPS portfolio record`);
    assert(!world.evidence.caseStudy, `world ${world.id} must not claim a public case study`);
  }
}

for (const link of Object.values(profile.links)) {
  assert(isHttps(link), `profile link must use HTTPS: ${link}`);
}

assert(Buffer.byteLength(readme) < 500 * 1024, "README exceeds GitHub's 500 KiB render threshold");

const banned = [
  /NO VANITY/i,
  /DARK MODE/i,
  /% SIGNAL/i,
  /github-readme-stats/i,
  /github-profile-trophy/i,
  /shields\.io/i,
  /streak/i,
  /profile views/i,
  /giphy/i,
  /capsule-render/i,
  /typing-svg/i,
  /snake/i,
  /buymeacoffee/i
];
for (const pattern of banned) {
  assert(!pattern.test(readme), `README contains forbidden profile-widget language: ${pattern}`);
}

assert(!/<(?:img|source)\b[^>]*(?:src|srcset)=["']https?:\/\//i.test(readme), "README contains an externally hosted image");

execFileSync(process.execPath, [resolve(root, "scripts/render-profile.mjs")], { cwd: root, stdio: "inherit" });
const first = await snapshot();
execFileSync(process.execPath, [resolve(root, "scripts/render-profile.mjs")], { cwd: root, stdio: "inherit" });
const second = await snapshot();
assert(JSON.stringify(first) === JSON.stringify(second), "profile artwork is not deterministic across two renders");

const expected = ["hero", "hero-mobile", "atlas", "atlas-mobile", "method", "method-mobile"]
  .flatMap((name) => [`${name}-light.svg`, `${name}-dark.svg`])
  .concat(profile.worlds.flatMap((world) => [`world-${world.id}-light.svg`, `world-${world.id}-dark.svg`]))
  .concat(profile.fieldNotes.flatMap((note) => [`field-note-${note.id}-light.svg`, `field-note-${note.id}-dark.svg`]))
  .sort();
const actual = Object.keys(second).sort();
assert(JSON.stringify(actual) === JSON.stringify(expected), `generated artwork set is incorrect\nExpected: ${expected.join(", ")}\nActual: ${actual.join(", ")}`);

for (const file of actual) {
  const path = resolve(generatedDir, file);
  const svg = await readFile(path, "utf8");
  const size = (await stat(path)).size;
  const limit = file.startsWith("hero-") ? 900 * 1024 : 128 * 1024;
  assert(size < limit, `${file} exceeds ${Math.round(limit / 1024)} KiB`);
  assert(svg.startsWith("<svg "), `${file} is not an SVG document`);
  assert(/role="img"/.test(svg) && /aria-labelledby="title desc"/.test(svg), `${file} lacks image semantics`);
  assert(/<title id="title">[^<]+<\/title>/.test(svg), `${file} lacks a title`);
  assert(/<desc id="desc">[^<]+<\/desc>/.test(svg), `${file} lacks a description`);
  assert(!/<script\b/i.test(svg), `${file} contains script`);
  assert(!/<foreignObject\b/i.test(svg), `${file} contains foreignObject`);
  assert(!/(?:href|src)="https?:\/\//i.test(svg), `${file} contains a remote resource`);
}

console.log(`Profile validation passed: ${profile.worlds.length} worlds, ${actual.length} deterministic SVGs, no remote artwork.`);
