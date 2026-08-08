import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profile = JSON.parse(await readFile(resolve(root, "content/profile.json"), "utf8"));
const portrait = await readFile(resolve(root, profile.heroPortrait.path));
const portraitData = `data:image/png;base64,${portrait.toString("base64")}`;
const outputDir = resolve(root, "assets/generated");

const themes = {
  light: {
    background: "#F2EADB",
    paper: "#FFF8EC",
    ink: "#151515",
    muted: "#635D52",
    grid: "#D2C4AD",
    cobalt: "#244BC4",
    orange: "#C9431C",
    glow: "#F0A02C"
  },
  dark: {
    background: "#0B0D12",
    paper: "#121720",
    ink: "#F4ECDE",
    muted: "#B8AF9F",
    grid: "#2D3544",
    cobalt: "#8BA4FF",
    orange: "#FF835C",
    glow: "#F4B247"
  }
};

const esc = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function wrap(value, limit = 56) {
  const words = String(value).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > limit && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function tspans(lines, x, y, lineHeight, className, fill) {
  return `<text x="${x}" y="${y}" class="${className}" fill="${fill}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${esc(line)}</tspan>`).join("")}</text>`;
}

function svgFrame({ width, height, title, description, theme, content, motion = false }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${esc(title)}</title>
  <desc id="desc">${esc(description)}</desc>
  <defs>
    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M24 0H0V24" fill="none" stroke="${theme.grid}" stroke-width="1" opacity=".42"/>
    </pattern>
    <pattern id="dither" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="2" height="2" fill="${theme.cobalt}" opacity=".2"/>
      <rect x="4" y="4" width="2" height="2" fill="${theme.orange}" opacity=".16"/>
    </pattern>
    <style>
      .serif { font-family: Georgia, 'Times New Roman', serif; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .label { font: 700 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 2px; text-transform: uppercase; }
      .small { font: 600 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .45px; }
      .body { font: 600 15px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .editorial { font: 700 32px Georgia, 'Times New Roman', serif; }
      .display { font: 700 48px Georgia, 'Times New Roman', serif; letter-spacing: -1.5px; }
      ${motion ? `.scan { animation: scan 6s linear infinite; }
      .pulse { transform-origin: center; animation: pulse 1.8s ease-in-out infinite; }
      .route { stroke-dasharray: 8 12; animation: route 10s linear infinite; }
      @keyframes scan { from { transform: translateY(-8px); } to { transform: translateY(${height + 8}px); } }
      @keyframes pulse { 50% { opacity: .25; transform: scale(.82); } }
      @keyframes route { to { stroke-dashoffset: -200; } }
      @media (prefers-reduced-motion: reduce) { .scan, .pulse, .route { animation: none; } }` : ""}
    </style>
  </defs>
  <rect width="${width}" height="${height}" rx="12" fill="${theme.background}"/>
  <rect x="10" y="10" width="${width - 20}" height="${height - 20}" rx="8" fill="url(#grid)" stroke="${theme.ink}" stroke-width="2"/>
${content.trimStart()}
</svg>\n`;
}

function renderHero(theme) {
  const { identity, chapter } = profile;
  const content = `
  <path d="M10 58H890M334 58V410" stroke="${theme.ink}" stroke-width="2"/>
  <rect x="22" y="22" width="144" height="23" fill="${theme.ink}"/>
  <text x="33" y="38" class="label" fill="${theme.background}">PLAYER // RAÚL</text>
  <text x="868" y="39" class="label" text-anchor="end" fill="${theme.muted}">${esc(identity.volume).toUpperCase()}</text>

  <rect x="34" y="72" width="278" height="278" rx="8" fill="${theme.paper}" stroke="${theme.ink}" stroke-width="2"/>
  <clipPath id="portrait"><rect x="48" y="84" width="250" height="244" rx="6"/></clipPath>
  <image href="${portraitData}" x="48" y="84" width="250" height="244" preserveAspectRatio="xMidYMid slice" clip-path="url(#portrait)"/>
  <path d="M48 84h34M48 84v34M298 84h-34M298 84v34M48 328h34M48 328v-34M298 328h-34M298 328v-34" fill="none" stroke="${theme.orange}" stroke-width="3"/>
  <rect x="54" y="307" width="125" height="15" fill="${theme.ink}" opacity=".9"/>
  <text x="61" y="318" class="label" fill="${theme.background}">WORLD BUILDER</text>
  <text x="173" y="377" class="label" text-anchor="middle" fill="${theme.muted}">@${esc(identity.handle)}</text>

  <g transform="translate(366 86)">
    <text class="label" fill="${theme.orange}">${esc(identity.role).toUpperCase()}</text>
    <text y="51" class="display" fill="${theme.ink}">${esc(identity.name)}</text>
    <text y="83" class="body" fill="${theme.cobalt}">CLASS / ${esc(identity.class).toUpperCase()}</text>
    <text y="108" class="small" fill="${theme.muted}">${esc(identity.location).toUpperCase()}</text>

    <rect y="140" width="492" height="148" rx="7" fill="${theme.paper}" stroke="${theme.ink}" stroke-width="2"/>
    <path d="M0 174H492" stroke="${theme.grid}"/>
    <text x="16" y="162" class="label" fill="${theme.orange}">ACTIVE THREAD</text>
    <text x="476" y="162" class="label" text-anchor="end" fill="${theme.cobalt}">${esc(chapter.state).toUpperCase()} ●</text>
    <text x="16" y="210" class="editorial" fill="${theme.ink}">${esc(chapter.title)}</text>
    ${tspans(wrap(chapter.thread, 52), 16, 240, 21, "small", theme.muted)}
    <path d="M16 274H352" stroke="${theme.orange}" stroke-width="3"/>
    <path d="M363 274h18m8 0h18m8 0h45" stroke="${theme.grid}" stroke-width="3"/>
  </g>

  <rect class="scan" x="12" y="0" width="876" height="2" fill="${theme.glow}" opacity=".24"/>
  <path d="M22 397h22v-5h12v5h22" stroke="${theme.cobalt}" stroke-width="2" fill="none"/>
  <text x="878" y="399" class="label" text-anchor="end" fill="${theme.muted}">${esc(chapter.footer).toUpperCase()}</text>`;

  return svgFrame({
    width: 900,
    height: 420,
    title: `${identity.name} — ${identity.role} and ${identity.class}`,
    description: `Editorial field-guide interface. Current chapter: ${chapter.title}. Active thread: ${chapter.thread}`,
    theme,
    content,
    motion: true
  });
}

function renderHeroMobile(theme) {
  const { identity, chapter } = profile;
  const content = `
  <path d="M10 58H410" stroke="${theme.ink}" stroke-width="2"/>
  <rect x="20" y="21" width="140" height="23" fill="${theme.ink}"/>
  <text x="30" y="37" class="label" fill="${theme.background}">PLAYER // RAÚL</text>
  <text x="398" y="38" class="label" text-anchor="end" fill="${theme.muted}">VOL. I</text>
  <clipPath id="portrait-mobile"><rect x="22" y="78" width="140" height="140" rx="6"/></clipPath>
  <rect x="20" y="76" width="144" height="144" rx="7" fill="${theme.paper}" stroke="${theme.ink}" stroke-width="2"/>
  <image href="${portraitData}" x="22" y="78" width="140" height="140" preserveAspectRatio="xMidYMid slice" clip-path="url(#portrait-mobile)"/>
  <path d="M22 78h22M22 78v22M162 78h-22M162 78v22M22 218h22M22 218v-22M162 218h-22M162 218v-22" fill="none" stroke="${theme.orange}" stroke-width="3"/>
  <g transform="translate(184 82)">
    <text class="label" fill="${theme.orange}">CREATIVE</text>
    <text y="19" class="label" fill="${theme.orange}">TECHNOLOGIST</text>
    <text y="57" class="serif" font-size="29" font-weight="700" fill="${theme.ink}">Raúl Iglesias</text>
    <text y="88" class="serif" font-size="29" font-weight="700" fill="${theme.ink}">Julios</text>
    <text y="119" class="small" fill="${theme.cobalt}">WORLD BUILDER</text>
    <text y="143" class="label" fill="${theme.muted}">ATLANTIC NODE</text>
  </g>
  <rect x="20" y="248" width="380" height="286" rx="7" fill="${theme.paper}" stroke="${theme.ink}" stroke-width="2"/>
  <path d="M20 284H400" stroke="${theme.grid}"/>
  <text x="36" y="272" class="label" fill="${theme.orange}">ACTIVE THREAD</text>
  <text x="384" y="272" class="label" text-anchor="end" fill="${theme.cobalt}">${esc(chapter.state).toUpperCase()} ●</text>
  <text x="36" y="336" class="serif" font-size="36" font-weight="700" fill="${theme.ink}">Systems people</text>
  <text x="36" y="378" class="serif" font-size="36" font-weight="700" fill="${theme.ink}">can enter</text>
  ${tspans(wrap(chapter.thread, 34), 36, 424, 26, "body", theme.muted)}
  <path d="M36 496H260" stroke="${theme.orange}" stroke-width="4"/>
  <path d="M270 496h24m10 0h24m10 0h46" stroke="${theme.grid}" stroke-width="4"/>
  <rect class="scan" x="12" y="0" width="396" height="2" fill="${theme.glow}" opacity=".24"/>
  <text x="398" y="592" class="label" text-anchor="end" fill="${theme.muted}">${esc(chapter.footer).toUpperCase()}</text>`;

  return svgFrame({
    width: 420,
    height: 610,
    title: `${identity.name} — ${identity.role} and ${identity.class}`,
    description: `Mobile editorial field guide. Current chapter: ${chapter.title}. Active thread: ${chapter.thread}`,
    theme,
    content,
    motion: true
  });
}

const atlasPositions = [
  [76, 110], [324, 72], [568, 112],
  [104, 340], [354, 370], [604, 334]
];

function renderAtlas(theme) {
  const nodes = profile.worlds.map((world, index) => {
    const [x, y] = atlasPositions[index];
    const active = index === 0;
    return `<g transform="translate(${x} ${y})">
      <rect width="220" height="118" rx="5" fill="${theme.paper}" stroke="${active ? theme.orange : theme.ink}" stroke-width="${active ? 3 : 2}"/>
      <path d="M0 30H220M38 0V30" stroke="${theme.grid}"/>
      <text x="12" y="20" class="label" fill="${theme.orange}">${esc(world.id)}</text>
      <text x="50" y="20" class="label" fill="${theme.muted}">${esc(world.discipline.split(" / ")[0]).toUpperCase()}</text>
      <text x="14" y="62" class="serif" font-size="${world.title.length > 20 ? 19 : 23}" font-weight="700" fill="${theme.ink}">${esc(world.title)}</text>
      <text x="14" y="88" class="small" fill="${theme.cobalt}">${esc(world.discipline.split(" / ")[1].toUpperCase())}</text>
      <path d="M14 102h116" stroke="${theme.grid}" stroke-width="2"/>
      <circle class="${active ? "pulse" : ""}" cx="196" cy="94" r="7" fill="${active ? theme.orange : theme.cobalt}"/>
    </g>`;
  }).join("");

  const content = `
  <text x="34" y="49" class="label" fill="${theme.orange}">ACT I / SIX WORLDS</text>
  <text x="866" y="49" class="label" text-anchor="end" fill="${theme.muted}">SELECTED FIELD MAP</text>
  <path class="route" d="M184 228C220 278 326 286 432 190S626 192 674 230 714 303 704 334M214 340C252 308 333 318 396 370" fill="none" stroke="${theme.cobalt}" stroke-width="3" opacity=".7"/>
  <path d="M34 68H866" stroke="${theme.ink}" stroke-width="2"/>
  ${nodes}
  <text x="34" y="532" class="small" fill="${theme.muted}">A ROUTE THROUGH MOTION, VOLUME, ACCESS, EVIDENCE, ORCHESTRATION AND ENERGY.</text>
  <text x="866" y="532" class="label" text-anchor="end" fill="${theme.orange}">OPEN THE DOSSIERS ↓</text>`;

  return svgFrame({
    width: 900,
    height: 550,
    title: "Atlas of six built worlds",
    description: "A connected field map of Renault 5 Turbo 3E, Gaussian Splatting Web, MAVI, Dreamly, KOVA and SolarScope.",
    theme,
    content,
    motion: true
  });
}

function renderAtlasMobile(theme) {
  const cards = profile.worlds.map((world, index) => {
    const y = 86 + index * 112;
    return `<g transform="translate(32 ${y})">
      <rect width="356" height="92" rx="5" fill="${theme.paper}" stroke="${index === 0 ? theme.orange : theme.ink}" stroke-width="${index === 0 ? 3 : 2}"/>
      <path d="M58 0v92M0 30h356" stroke="${theme.grid}"/>
      <text x="17" y="21" class="label" fill="${theme.orange}">${esc(world.id)}</text>
      <text x="72" y="21" class="label" fill="${theme.muted}">${esc(world.discipline).toUpperCase()}</text>
      <text x="76" y="62" class="serif" font-size="${world.title.length > 20 ? 18 : 22}" font-weight="700" fill="${theme.ink}">${esc(world.title)}</text>
      <circle class="${index === 0 ? "pulse" : ""}" cx="330" cy="61" r="7" fill="${index === 0 ? theme.orange : theme.cobalt}"/>
    </g>`;
  }).join("");

  const content = `
  <text x="22" y="39" class="label" fill="${theme.orange}">ACT I / SIX WORLDS</text>
  <text x="398" y="39" class="label" text-anchor="end" fill="${theme.muted}">FIELD MAP</text>
  <path d="M10 58H410" stroke="${theme.ink}" stroke-width="2"/>
  <path class="route" d="M54 112V704" stroke="${theme.cobalt}" stroke-width="4" fill="none"/>
  ${cards}
  <text x="398" y="786" class="label" text-anchor="end" fill="${theme.orange}">OPEN THE DOSSIERS ↓</text>`;

  return svgFrame({
    width: 420,
    height: 804,
    title: "Mobile atlas of six built worlds",
    description: "A vertical route through Renault 5 Turbo 3E, Gaussian Splatting Web, MAVI, Dreamly, KOVA and SolarScope.",
    theme,
    content,
    motion: true
  });
}

function motifMotion(theme) {
  return `<g transform="translate(535 68)">
    <path d="M8 188h258l74-82-33-42H111L45 116Z" fill="none" stroke="${theme.ink}" stroke-width="4"/>
    <circle cx="100" cy="192" r="35" fill="${theme.paper}" stroke="${theme.cobalt}" stroke-width="5"/>
    <circle cx="279" cy="192" r="35" fill="${theme.paper}" stroke="${theme.cobalt}" stroke-width="5"/>
    <path d="M0 36h228M-18 66h150M20 96h86" stroke="${theme.orange}" stroke-width="4"/>
    <path d="M146 72h112l42 48H110Z" fill="url(#dither)" stroke="${theme.ink}" stroke-width="2"/>
    <text x="348" y="42" class="label" text-anchor="end" fill="${theme.muted}">CAM / 03</text>
  </g>`;
}

function motifPointCloud(theme) {
  const points = Array.from({ length: 88 }, (_, index) => {
    const angle = index * 2.399;
    const radius = 12 + (index % 23) * 6.4;
    const x = 708 + Math.cos(angle) * radius * 1.14;
    const y = 178 + Math.sin(angle) * radius * .78;
    const r = index % 7 === 0 ? 4 : 2.2;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${index % 4 === 0 ? theme.orange : theme.cobalt}" opacity="${.35 + (index % 5) * .12}"/>`;
  }).join("");
  return `<g>${points}<ellipse cx="708" cy="178" rx="162" ry="108" fill="none" stroke="${theme.ink}" stroke-width="2"/><path d="M538 178h340M708 58v240" stroke="${theme.grid}" stroke-dasharray="4 8"/><text x="862" y="72" class="label" text-anchor="end" fill="${theme.muted}">FOV / 54°</text></g>`;
}

function motifFloorplan(theme) {
  return `<g transform="translate(540 54)" fill="none">
    <path d="M16 26h304v234H16zM16 104h92V26M108 104h88v76h124M196 104V26M108 180v80M252 180v80" stroke="${theme.ink}" stroke-width="4"/>
    <path d="M108 79v50M196 79v50M227 180h50" stroke="${theme.background}" stroke-width="9"/>
    <path d="M108 80a24 24 0 0 1 24 24M196 80a24 24 0 0 0-24 24M228 180a24 24 0 0 1 24 24" stroke="${theme.orange}" stroke-width="3"/>
    <path d="M54 218C80 194 102 210 128 194s55-4 74-31 41-17 69-38" stroke="${theme.cobalt}" stroke-width="4" stroke-dasharray="6 8"/>
    <circle cx="54" cy="218" r="8" fill="${theme.orange}"/><circle cx="271" cy="125" r="8" fill="${theme.cobalt}"/>
    <text x="320" y="284" class="label" text-anchor="end" fill="${theme.muted}">OPEN CIRCULATION</text>
  </g>`;
}

function motifEvidence(theme) {
  const labels = ["ASK", "FIND", "CHECK", "ANSWER"];
  return `<g transform="translate(526 82)">
    <path d="M38 122H326" stroke="${theme.cobalt}" stroke-width="5"/>
    ${labels.map((label, index) => `<g transform="translate(${38 + index * 96} 122)"><circle r="25" fill="${theme.paper}" stroke="${index === 2 ? theme.orange : theme.ink}" stroke-width="4"/><text y="4" class="label" text-anchor="middle" fill="${index === 2 ? theme.orange : theme.ink}">${label}</text></g>`).join("")}
    <path d="M116 54h132l28 30-28 30H116L88 84Z" fill="url(#dither)" stroke="${theme.grid}" stroke-width="2"/>
    <text x="182" y="89" class="small" text-anchor="middle" fill="${theme.muted}">EVIDENCE ROUTE</text>
    <path d="M38 164v34h288v-34" fill="none" stroke="${theme.orange}" stroke-width="3"/>
    <text x="182" y="225" class="label" text-anchor="middle" fill="${theme.muted}">LIMITS STAY VISIBLE</text>
  </g>`;
}

function motifAgent(theme) {
  return `<g transform="translate(524 58)">
    <circle cx="188" cy="136" r="118" fill="none" stroke="${theme.grid}" stroke-width="3" stroke-dasharray="8 10"/>
    <circle cx="188" cy="136" r="79" fill="${theme.paper}" stroke="${theme.cobalt}" stroke-width="4"/>
    <text x="188" y="131" class="editorial" text-anchor="middle" fill="${theme.ink}">KOVA</text>
    <text x="188" y="153" class="label" text-anchor="middle" fill="${theme.orange}">AGENT OS</text>
    ${[[40,52,"PROVIDER"],[330,58,"BACKEND"],[52,236,"CHANNELS"],[326,228,"SECURITY"]].map(([x,y,label]) => `<g transform="translate(${x} ${y})"><rect x="-42" y="-18" width="84" height="36" rx="4" fill="${theme.paper}" stroke="${theme.ink}" stroke-width="2"/><text y="4" class="label" text-anchor="middle" fill="${theme.muted}">${label}</text><path d="M${x < 188 ? 42 : -42} 0H${x < 188 ? 85 : -85}" stroke="${theme.orange}" stroke-width="3"/></g>`).join("")}
  </g>`;
}

function motifSolar(theme) {
  return `<g transform="translate(530 54)">
    <path d="M28 206C78 74 166 36 332 64" fill="none" stroke="${theme.orange}" stroke-width="4" stroke-dasharray="8 10"/>
    <circle cx="298" cy="65" r="28" fill="${theme.glow}" opacity=".85"/>
    <g transform="translate(82 132) skewX(-12)">
      <rect width="205" height="116" fill="${theme.cobalt}" opacity=".22" stroke="${theme.ink}" stroke-width="4"/>
      <path d="M41 0v116M82 0v116M123 0v116M164 0v116M0 38h205M0 77h205" stroke="${theme.cobalt}" stroke-width="2"/>
    </g>
    <path d="M42 272h310M62 272l22-41M330 272l-34-72" stroke="${theme.ink}" stroke-width="4"/>
    <path d="M50 302c44-36 72 2 116-28s74 12 116-17 62-5 86-30" fill="none" stroke="${theme.orange}" stroke-width="3"/>
    <text x="350" y="320" class="label" text-anchor="end" fill="${theme.muted}">OUTPUT / LOSSES / TIME</text>
  </g>`;
}

function worldMotif(world, theme) {
  switch (world.motif) {
    case "motion": return motifMotion(theme);
    case "point-cloud": return motifPointCloud(theme);
    case "floorplan": return motifFloorplan(theme);
    case "evidence-route": return motifEvidence(theme);
    case "agent-pipeline": return motifAgent(theme);
    case "solar-system": return motifSolar(theme);
    default: return "";
  }
}

function renderWorld(world, theme) {
  const summary = wrap(world.summary, 48).slice(0, 3);
  const content = `
  <path d="M10 58H890M493 58V390" stroke="${theme.ink}" stroke-width="2"/>
  <text x="32" y="40" class="label" fill="${theme.orange}">WORLD / ${esc(world.id)}</text>
  <text x="868" y="40" class="label" text-anchor="end" fill="${theme.muted}">${esc(world.discipline).toUpperCase()}</text>
  <g transform="translate(34 88)">
    <text class="serif" font-size="${world.title.length > 20 ? 35 : 44}" font-weight="700" fill="${theme.ink}">${esc(world.title)}</text>
    ${world.alias ? `<text y="30" class="small" fill="${theme.cobalt}">ALIAS / ${esc(world.alias).toUpperCase()}</text>` : ""}
    ${tspans(summary, 0, world.alias ? 76 : 62, 24, "body", theme.muted)}
    <path d="M0 184H410" stroke="${theme.grid}" stroke-width="2"/>
    ${world.decisions.map((decision, index) => `<text y="${214 + index * 25}" class="small" fill="${index === 0 ? theme.orange : theme.ink}">${String(index + 1).padStart(2, "0")}  ${esc(decision).toUpperCase()}</text>`).join("")}
  </g>
  ${worldMotif(world, theme)}
  <text x="868" y="382" class="label" text-anchor="end" fill="${theme.muted}">${world.evidence.kind === "case-study" ? "CASE STUDY + LIVE WORLD" : "LIVE WORLD + PORTFOLIO RECORD"}</text>`;

  return svgFrame({
    width: 900,
    height: 400,
    title: `${world.id} — ${world.title}: ${world.discipline}`,
    description: `${world.summary} Key decisions: ${world.decisions.join(", ")}.`,
    theme,
    content
  });
}

function renderMethod(theme) {
  const stageWidth = 126;
  const stages = profile.method.stages.map((stage, index) => {
    const x = 55 + index * stageWidth;
    const y = index % 2 === 0 ? 137 : 183;
    return `<g transform="translate(${x} ${y})">
      <circle r="29" fill="${theme.paper}" stroke="${index === 0 || index === 5 ? theme.orange : theme.ink}" stroke-width="3"/>
      <text y="4" class="label" text-anchor="middle" fill="${index === 0 || index === 5 ? theme.orange : theme.ink}">${String(index + 1).padStart(2, "0")}</text>
      <text y="52" class="small" text-anchor="middle" fill="${theme.muted}">${esc(stage).toUpperCase()}</text>
    </g>`;
  }).join("");

  const disciplines = profile.method.disciplines.map((discipline, index) => {
    const y = 323 + index * 50;
    return `<g transform="translate(50 ${y})">
      <text class="label" fill="${[theme.orange, theme.cobalt, theme.ink][index]}">${esc(discipline.name).toUpperCase()}</text>
      <path d="M122 -4H240" stroke="${theme.grid}" stroke-width="2"/>
      <text x="260" class="small" fill="${theme.muted}">${esc(discipline.items.join(" · "))}</text>
    </g>`;
  }).join("");

  const content = `
  <text x="34" y="48" class="label" fill="${theme.orange}">ACT II / HOW THE WORLDS ARE MADE</text>
  <text x="866" y="48" class="label" text-anchor="end" fill="${theme.muted}">A REPEATABLE LOOP, NOT A RECIPE</text>
  <path d="M34 68H866" stroke="${theme.ink}" stroke-width="2"/>
  <path d="M55 137C174 137 185 183 307 183S436 137 559 137 686 183 811 183" fill="none" stroke="${theme.cobalt}" stroke-width="4"/>
  ${stages}
  <rect x="32" y="288" width="836" height="178" rx="7" fill="${theme.paper}" stroke="${theme.ink}" stroke-width="2"/>
  ${disciplines}
  <text x="866" y="489" class="label" text-anchor="end" fill="${theme.orange}">OBSERVE AGAIN ↺</text>`;

  return svgFrame({
    width: 900,
    height: 510,
    title: "How the worlds are made",
    description: `A six-stage loop: ${profile.method.stages.join(", ")}. It crosses the disciplines Space, Systems and Intelligence.`,
    theme,
    content
  });
}

function renderMethodMobile(theme) {
  const stages = profile.method.stages.map((stage, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 30 + column * 190;
    const y = 92 + row * 104;
    return `<g transform="translate(${x} ${y})">
      <rect width="170" height="78" rx="5" fill="${theme.paper}" stroke="${index === 0 || index === 5 ? theme.orange : theme.ink}" stroke-width="3"/>
      <text x="16" y="24" class="label" fill="${index === 0 || index === 5 ? theme.orange : theme.muted}">${String(index + 1).padStart(2, "0")}</text>
      <text x="16" y="55" class="serif" font-size="21" font-weight="700" fill="${theme.ink}">${esc(stage)}</text>
    </g>`;
  }).join("");

  const disciplines = profile.method.disciplines.map((discipline, index) => {
    const y = 448 + index * 92;
    return `<g transform="translate(30 ${y})">
      <text class="label" fill="${[theme.orange, theme.cobalt, theme.ink][index]}">${esc(discipline.name).toUpperCase()}</text>
      ${tspans(wrap(discipline.items.join(" · "), 42), 0, 30, 20, "small", theme.muted)}
    </g>`;
  }).join("");

  const content = `
  <text x="22" y="39" class="label" fill="${theme.orange}">ACT II / MAKING LOOP</text>
  <text x="398" y="39" class="label" text-anchor="end" fill="${theme.muted}">OBSERVE AGAIN ↺</text>
  <path d="M10 58H410" stroke="${theme.ink}" stroke-width="2"/>
  <path d="M114 170c44 18 148 18 192 0M114 274c44 18 148 18 192 0" fill="none" stroke="${theme.cobalt}" stroke-width="3" stroke-dasharray="6 8"/>
  ${stages}
  <rect x="20" y="414" width="380" height="298" rx="7" fill="${theme.paper}" stroke="${theme.ink}" stroke-width="2"/>
  ${disciplines}`;

  return svgFrame({
    width: 420,
    height: 732,
    title: "Mobile map of the making method",
    description: `A six-stage loop: ${profile.method.stages.join(", ")}, crossing Space, Systems and Intelligence.`,
    theme,
    content
  });
}

function fieldMotif(note, theme) {
  if (note.motif === "orbit") {
    return `<g transform="translate(680 140)" fill="none"><ellipse rx="130" ry="62" stroke="${theme.cobalt}" stroke-width="4"/><ellipse rx="76" ry="116" stroke="${theme.grid}" stroke-width="3" transform="rotate(55)"/><circle cx="-88" cy="-43" r="10" fill="${theme.orange}"/><path d="M-22 0h44M0-22v44" stroke="${theme.ink}" stroke-width="3"/></g>`;
  }
  if (note.motif === "signal") {
    return `<g transform="translate(570 74)"><path d="M0 84h66l32-42 52 92 46-68 48 38h82" fill="none" stroke="${theme.cobalt}" stroke-width="5"/><circle cx="150" cy="134" r="12" fill="${theme.orange}"/><path d="M0 164h326M0 184h236" stroke="${theme.grid}" stroke-width="3"/><text x="326" y="210" class="label" text-anchor="end" fill="${theme.muted}">SOURCE → LIMIT → RESPONSE</text></g>`;
  }
  return `<g transform="translate(592 52)"><path d="M0 176V24h214v152M46 176V82h122v94" fill="none" stroke="${theme.ink}" stroke-width="5"/><path d="M107 82v94" stroke="${theme.background}" stroke-width="12"/><path d="M107 82a48 48 0 0 1 48 48" fill="none" stroke="${theme.orange}" stroke-width="4"/><path d="M-30 176h304" stroke="${theme.cobalt}" stroke-width="4"/><circle cx="107" cy="176" r="10" fill="${theme.cobalt}"/></g>`;
}

function renderFieldNote(note, theme) {
  const content = `
  <path d="M10 58H890M520 58V270" stroke="${theme.ink}" stroke-width="2"/>
  <text x="32" y="40" class="label" fill="${theme.orange}">FIELD NOTE / ${esc(note.id)}</text>
  <text x="868" y="40" class="label" text-anchor="end" fill="${theme.muted}">WORKING PRINCIPLE</text>
  <text x="34" y="116" class="serif" font-size="39" font-weight="700" fill="${theme.ink}">${esc(note.title)}</text>
  ${tspans(wrap(note.text, 48), 34, 158, 24, "body", theme.muted)}
  ${fieldMotif(note, theme)}`;

  return svgFrame({
    width: 900,
    height: 280,
    title: `Field note ${note.id}: ${note.title}`,
    description: note.text,
    theme,
    content
  });
}

await mkdir(outputDir, { recursive: true });

async function writeSvg(filename, svg) {
  const normalized = svg.replace(/[ \t]+$/gm, "");
  await writeFile(resolve(outputDir, filename), normalized, "utf8");
}

for (const [themeName, theme] of Object.entries(themes)) {
  await writeSvg(`hero-${themeName}.svg`, renderHero(theme));
  await writeSvg(`hero-mobile-${themeName}.svg`, renderHeroMobile(theme));
  await writeSvg(`atlas-${themeName}.svg`, renderAtlas(theme));
  await writeSvg(`atlas-mobile-${themeName}.svg`, renderAtlasMobile(theme));
  await writeSvg(`method-${themeName}.svg`, renderMethod(theme));
  await writeSvg(`method-mobile-${themeName}.svg`, renderMethodMobile(theme));

  for (const world of profile.worlds) {
    await writeSvg(`world-${world.id}-${themeName}.svg`, renderWorld(world, theme));
  }

  for (const note of profile.fieldNotes) {
    await writeSvg(`field-note-${note.id}-${themeName}.svg`, renderFieldNote(note, theme));
  }
}

console.log(`Rendered ${12 + profile.worlds.length * 2 + profile.fieldNotes.length * 2} profile SVGs.`);
