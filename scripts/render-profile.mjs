import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profile = JSON.parse(await readFile(resolve(root, "content/profile.json"), "utf8"));
const avatar = await readFile(resolve(root, profile.avatar.path));
const avatarData = `data:image/png;base64,${avatar.toString("base64")}`;

const themes = {
  light: {
    background: "#F3EBDD",
    panel: "#FFF9ED",
    ink: "#171717",
    muted: "#655F55",
    grid: "#D8CCB8",
    cobalt: "#3157D5",
    orange: "#E65A2F",
    orangeSoft: "#F6B349"
  },
  dark: {
    background: "#0B0E14",
    panel: "#111722",
    ink: "#F1EBDD",
    muted: "#A8A296",
    grid: "#273042",
    cobalt: "#7A96FF",
    orange: "#FF784F",
    orangeSoft: "#F6B349"
  }
};

const esc = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function render(themeName, theme) {
  const p = profile.currentQuest.progress;
  const barWidth = Math.round(360 * Math.max(0, Math.min(100, p)) / 100);
  const dots = Array.from({ length: 23 }, (_, index) => {
    const x = 22 + ((index * 79) % 850);
    const y = 18 + ((index * 53) % 382);
    const color = index % 4 === 0 ? theme.orange : theme.grid;
    return `<rect x="${x}" y="${y}" width="${index % 3 === 0 ? 4 : 2}" height="${index % 3 === 0 ? 4 : 2}" fill="${color}" opacity="${index % 4 === 0 ? 0.7 : 0.45}"/>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="420" viewBox="0 0 900 420" role="img" aria-labelledby="title desc">
  <title id="title">${esc(profile.identity.name)} â€” ${esc(profile.identity.role)}</title>
  <desc id="desc">An editorial pixel-art RPG interface presenting RaÃºl as a World Builder. Current quest: ${esc(profile.currentQuest.title)}.</desc>
  <defs>
    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M24 0H0V24" fill="none" stroke="${theme.grid}" stroke-width="1" opacity="0.34"/>
    </pattern>
    <pattern id="dither" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect x="0" y="0" width="2" height="2" fill="${theme.cobalt}" opacity="0.18"/>
      <rect x="4" y="4" width="2" height="2" fill="${theme.orange}" opacity="0.14"/>
    </pattern>
    <clipPath id="avatarClip"><rect x="49" y="75" width="250" height="250" rx="8"/></clipPath>
    <style>
      .label { font: 700 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 2px; }
      .display { font: 800 32px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: -1px; }
      .body { font: 600 15px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .small { font: 600 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .5px; }
      .scan { animation: scan 5.5s linear infinite; }
      .blink { animation: blink 1.4s steps(2,end) infinite; }
      @keyframes scan { from { transform: translateY(-12px); } to { transform: translateY(410px); } }
      @keyframes blink { 50% { opacity: .18; } }
      @media (prefers-reduced-motion: reduce) { .scan, .blink { animation: none; } }
    </style>
  </defs>
  <rect width="900" height="420" rx="12" fill="${theme.background}"/>
  <rect x="10" y="10" width="880" height="400" rx="8" fill="url(#grid)" stroke="${theme.ink}" stroke-width="2"/>
  ${dots}
  <path d="M10 56H890M335 56V410" stroke="${theme.ink}" stroke-width="2"/>
  <rect x="22" y="22" width="116" height="22" fill="${theme.ink}"/>
  <text x="32" y="37" class="label" fill="${theme.background}">PLAYER // 01</text>
  <text x="868" y="38" class="label" text-anchor="end" fill="${theme.muted}">PROFILE BUILD 01</text>

  <rect x="35" y="67" width="278" height="276" rx="9" fill="${theme.panel}" stroke="${theme.ink}" stroke-width="2"/>
  <rect x="49" y="75" width="250" height="250" rx="8" fill="${theme.background}"/>
  <image href="${avatarData}" x="49" y="75" width="250" height="250" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>
  <path d="M49 75h32M49 75v32M299 75h-32M299 75v32M49 325h32M49 325v-32M299 325h-32M299 325v-32" fill="none" stroke="${theme.orange}" stroke-width="3"/>
  <rect x="54" y="309" width="116" height="12" fill="${theme.ink}" opacity=".86"/>
  <text x="60" y="318" class="label" fill="${theme.background}">WORLD BUILDER</text>
  <text x="174" y="368" class="label" text-anchor="middle" fill="${theme.muted}">@${esc(profile.identity.handle)}</text>

  <g transform="translate(365 86)">
    <text class="label" fill="${theme.orange}">${esc(profile.identity.role).toUpperCase()}</text>
    <text y="46" class="display" fill="${theme.ink}">${esc(profile.identity.name)}</text>
    <text y="77" class="body" fill="${theme.cobalt}">CLASS  /  ${esc(profile.identity.class).toUpperCase()}</text>
    <text y="103" class="small" fill="${theme.muted}">CHAPTER  /  ${esc(profile.identity.chapter)}</text>

    <rect y="138" width="492" height="126" rx="7" fill="${theme.panel}" stroke="${theme.ink}" stroke-width="2"/>
    <path d="M0 169H492" stroke="${theme.grid}"/>
    <text x="16" y="159" class="label" fill="${theme.orange}">${esc(profile.currentQuest.label)}</text>
    <text x="16" y="199" class="body" fill="${theme.ink}">${esc(profile.currentQuest.title)}</text>
    <text x="476" y="159" class="label blink" text-anchor="end" fill="${theme.cobalt}">${esc(profile.currentQuest.status)} â—</text>
    <rect x="16" y="222" width="360" height="12" fill="${theme.grid}"/>
    <rect x="16" y="222" width="${barWidth}" height="12" fill="${theme.orange}"/>
    <path d="M16 240H376" stroke="${theme.ink}" stroke-dasharray="2 10" opacity=".35"/>
    <text x="476" y="233" class="label" text-anchor="end" fill="${theme.muted}">${p}% SIGNAL</text>
    <text x="16" y="252" class="small" fill="${theme.muted}">${esc(profile.identity.location)}  Â·  HUMAN-FIRST SYSTEMS</text>
  </g>

  <rect class="scan" x="12" y="0" width="876" height="2" fill="${theme.orangeSoft}" opacity=".24"/>
  <path d="M22 397h18v-4h12v4h18" stroke="${theme.cobalt}" stroke-width="2" fill="none"/>
  <text x="878" y="399" class="label" text-anchor="end" fill="${theme.muted}">${themeName.toUpperCase()} MODE // NO VANITY METRICS</text>
</svg>`;
}

const outputDir = resolve(root, "assets/generated");
await mkdir(outputDir, { recursive: true });

for (const [name, theme] of Object.entries(themes)) {
  await writeFile(resolve(outputDir, `hero-${name}.svg`), render(name, theme), "utf8");
}

console.log("Rendered hero-light.svg and hero-dark.svg");

