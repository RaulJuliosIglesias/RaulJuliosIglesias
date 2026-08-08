#!/usr/bin/env node

/**
 * Atlantic Pixel Artbook V3 integrity validator (dependency-free, read-only).
 *
 * The validator never writes to the repository and can run from any directory
 * with: node scripts/check-profile.mjs
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const KiB = 1024;
const MiB = 1024 * KiB;

const EXPECTED_BUDGETS = Object.freeze({
  staticMaxBytes: 256_000,
  animatedMaxBytes: 921_600,
  effectiveMaxBytes: 5_242_880,
});

const REQUIRED_PALETTE = Object.freeze([
  '#101816',
  '#EEE2CC',
  '#C8AF84',
  '#285B5A',
  '#477A8B',
  '#C95C38',
  '#6E765A',
]);

const WORLD_IDS = Object.freeze([
  'renault-5-turbo-3e',
  'gaussian-splatting-web',
  'mavi',
  'dreamly',
  'kova',
  'solarscope',
]);

const COVER_IDS = Object.freeze([
  'cover-renault',
  'cover-gaussian',
  'cover-mavi',
  'cover-dreamly',
]);

const EXPECTED_ARTWORKS = new Map([
  ['hero', { required: ['static', 'mobile'], allowed: ['static', 'mobile'], dimensions: { static: [900, 420], mobile: [720, 1000] } }],
  ['atlas', { required: ['static', 'mobile'], allowed: ['static', 'mobile'], dimensions: { static: [900, 600], mobile: [720, 1180] } }],
  ...WORLD_IDS.map((id) => [id, { required: ['static'], allowed: ['static', 'animated'], dimensions: { static: [900, 480], animated: [900, 480] } }]),
  ['workshop', { required: ['static'], allowed: ['static'], dimensions: { static: [900, null] } }],
  ...COVER_IDS.map((id) => [id, { required: ['static'], allowed: ['static'], dimensions: { static: [1280, 640] } }]),
]);

const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function formatBytes(bytes) {
  if (bytes >= MiB) return `${(bytes / MiB).toFixed(2)} MiB`;
  return `${(bytes / KiB).toFixed(1)} KiB`;
}

function normalizedHex(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toUpperCase()
    : null;
}

function isHttpsUrl(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function getAttr(tag, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(pattern);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
}

function srcsetPaths(value) {
  if (!isNonEmptyString(value)) return [];
  return value
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function stripMarkdownComments(markdown) {
  return markdown.replace(/<!--[\s\S]*?-->/g, '');
}

function findRepoRoot() {
  const explicit = process.argv.find((argument) => argument.startsWith('--root='));
  const starts = explicit
    ? [path.resolve(explicit.slice('--root='.length))]
    : [path.resolve(process.cwd()), path.dirname(fileURLToPath(import.meta.url))];

  for (const start of starts) {
    let cursor = start;
    while (true) {
      if (
        existsSync(path.join(cursor, 'README.md'))
        && existsSync(path.join(cursor, 'content', 'profile.json'))
      ) {
        return cursor;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }

  throw new Error('Could not locate repository root (README.md + content/profile.json).');
}

function localPathFromManifest(root, relativePath, label) {
  if (!isNonEmptyString(relativePath)) {
    fail(`${label}: path must be a non-empty string.`);
    return null;
  }
  if (relativePath.includes('\\')) {
    fail(`${label}: use POSIX separators in manifest paths: ${relativePath}`);
    return null;
  }
  if (/^(?:[a-z]+:)?\/\//i.test(relativePath) || path.posix.isAbsolute(relativePath)) {
    fail(`${label}: path must be repository-local: ${relativePath}`);
    return null;
  }
  if (relativePath.includes('?') || relativePath.includes('#') || relativePath.includes('%')) {
    fail(`${label}: path may not contain query strings, fragments, or escapes: ${relativePath}`);
    return null;
  }

  const normalized = path.posix.normalize(relativePath.replace(/^\.\//, ''));
  if (normalized !== relativePath || normalized.startsWith('../') || normalized === '..') {
    fail(`${label}: path is not canonical or escapes the repository: ${relativePath}`);
    return null;
  }
  if (!normalized.startsWith('assets/artbook-v3/')) {
    fail(`${label}: file must live below assets/artbook-v3/: ${relativePath}`);
    return null;
  }

  const absolute = path.resolve(root, ...normalized.split('/'));
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${label}: resolved path escapes the repository: ${relativePath}`);
    return null;
  }
  return absolute;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function usedIndexedPngColors(idat, width, height, bitDepth, palette, alphaByIndex) {
  let inflated;
  try {
    inflated = inflateSync(Buffer.concat(idat));
  } catch (error) {
    throw new Error(`IDAT zlib stream is invalid: ${error.message}`);
  }

  const rowBytes = Math.ceil((width * bitDepth) / 8);
  const expectedLength = (rowBytes + 1) * height;
  if (inflated.length !== expectedLength) {
    throw new Error(`inflated IDAT is ${inflated.length} bytes; expected ${expectedLength}`);
  }

  const reconstructed = Buffer.alloc(rowBytes * height);
  let inputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    if (filter > 4) throw new Error(`unsupported PNG filter ${filter} on row ${y}`);

    const rowOffset = y * rowBytes;
    const previousOffset = rowOffset - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const encoded = inflated[inputOffset + x];
      const left = x > 0 ? reconstructed[rowOffset + x - 1] : 0;
      const above = y > 0 ? reconstructed[previousOffset + x] : 0;
      const upperLeft = x > 0 && y > 0 ? reconstructed[previousOffset + x - 1] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      if (filter === 2) predictor = above;
      if (filter === 3) predictor = Math.floor((left + above) / 2);
      if (filter === 4) predictor = paethPredictor(left, above, upperLeft);
      reconstructed[rowOffset + x] = (encoded + predictor) & 0xFF;
    }
    inputOffset += rowBytes;
  }

  const mask = (1 << bitDepth) - 1;
  const usedIndices = new Set();
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowBytes;
    for (let x = 0; x < width; x += 1) {
      const bitOffset = x * bitDepth;
      const byte = reconstructed[rowOffset + Math.floor(bitOffset / 8)];
      const shift = 8 - bitDepth - (bitOffset % 8);
      usedIndices.add((byte >>> shift) & mask);
    }
  }

  const colors = [];
  const visibleIndices = [];
  for (const index of [...usedIndices].sort((a, b) => a - b)) {
    if (index >= palette.length) {
      throw new Error(`pixel references palette index ${index}, but PLTE has ${palette.length} entries`);
    }
    // A fully transparent padding index is storage, not a visible palette
    // color. Partially transparent colors remain part of the artwork palette.
    if (alphaByIndex?.[index] === 0) continue;
    colors.push(palette[index]);
    visibleIndices.push(index);
  }
  return { colors, visibleIndices };
}

function parsePng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error('invalid PNG signature');
  }

  let offset = 8;
  let ihdr = null;
  let palette = null;
  let alphaByIndex = null;
  let seenIend = false;
  const idat = [];
  const chunkTypes = [];

  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw new Error('truncated PNG chunk header');
    const length = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.length) throw new Error('truncated PNG chunk payload');

    const typeBuffer = buffer.subarray(offset + 4, offset + 8);
    const type = typeBuffer.toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const storedCrc = buffer.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(Buffer.concat([typeBuffer, data]));
    if (storedCrc !== actualCrc) throw new Error(`${type} chunk CRC mismatch`);
    chunkTypes.push(type);

    if (type === 'IHDR') {
      if (ihdr || length !== 13 || chunkTypes.length !== 1) throw new Error('IHDR must be the first, unique 13-byte chunk');
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'PLTE') {
      if (length === 0 || length % 3 !== 0 || length > 768) throw new Error('PLTE length must encode 1-256 RGB entries');
      palette = [];
      for (let index = 0; index < length; index += 3) {
        palette.push(`#${data[index].toString(16).padStart(2, '0')}${data[index + 1].toString(16).padStart(2, '0')}${data[index + 2].toString(16).padStart(2, '0')}`.toUpperCase());
      }
    } else if (type === 'tRNS') {
      if (!palette) throw new Error('indexed tRNS must appear after PLTE');
      if (length > palette.length) throw new Error('tRNS has more alpha entries than PLTE colors');
      alphaByIndex = [...data];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      if (length !== 0) throw new Error('IEND must be empty');
      seenIend = true;
      if (chunkEnd !== buffer.length) throw new Error('trailing bytes after IEND');
    } else if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') {
      throw new Error('APNG chunks are not allowed; motion assets must be animated WebP');
    }

    offset = chunkEnd;
    if (seenIend) break;
  }

  if (!ihdr) throw new Error('missing IHDR');
  if (!seenIend) throw new Error('missing IEND');
  if (ihdr.width === 0 || ihdr.height === 0) throw new Error('zero-sized PNG');
  if (ihdr.compression !== 0 || ihdr.filter !== 0 || ihdr.interlace !== 0) {
    throw new Error('PNG must use standard compression/filtering and be non-interlaced');
  }
  if (ihdr.colorType !== 3 || ![1, 2, 4, 8].includes(ihdr.bitDepth)) {
    throw new Error('PNG must be indexed-color (type 3) with 1, 2, 4, or 8 bits per pixel');
  }
  if (!palette) throw new Error('indexed PNG is missing PLTE');
  if (palette.length > (1 << ihdr.bitDepth)) throw new Error('PLTE has more entries than the indexed bit depth permits');
  if (idat.length === 0) throw new Error('missing IDAT');

  const visiblePalette = usedIndexedPngColors(idat, ihdr.width, ihdr.height, ihdr.bitDepth, palette, alphaByIndex);
  return {
    ...ihdr,
    paletteEntries: palette.length,
    usedColors: visiblePalette.colors,
    usedPaletteIndices: visiblePalette.visibleIndices,
  };
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function parseAnimatedWebp(buffer) {
  if (
    buffer.length < 30
    || buffer.subarray(0, 4).toString('ascii') !== 'RIFF'
    || buffer.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    throw new Error('invalid WebP RIFF signature');
  }
  const declaredRiffBytes = buffer.readUInt32LE(4) + 8;
  if (declaredRiffBytes !== buffer.length) {
    throw new Error(`RIFF declares ${declaredRiffBytes} bytes, file has ${buffer.length}`);
  }

  let offset = 12;
  let canvas = null;
  let vp8xFlags = null;
  let hasAnim = false;
  const frames = [];

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) throw new Error('truncated WebP chunk header');
    const type = buffer.subarray(offset, offset + 4).toString('ascii');
    const length = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) throw new Error(`truncated ${type} chunk`);
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === 'VP8X') {
      if (canvas || length !== 10) throw new Error('VP8X must be a unique 10-byte chunk');
      vp8xFlags = data[0];
      canvas = {
        width: readUInt24LE(data, 4) + 1,
        height: readUInt24LE(data, 7) + 1,
      };
    } else if (type === 'ANIM') {
      if (length !== 6) throw new Error('ANIM must be a 6-byte chunk');
      hasAnim = true;
    } else if (type === 'ANMF') {
      if (length < 16) throw new Error('ANMF frame header is truncated');
      frames.push({
        x: readUInt24LE(data, 0) * 2,
        y: readUInt24LE(data, 3) * 2,
        width: readUInt24LE(data, 6) + 1,
        height: readUInt24LE(data, 9) + 1,
        durationMs: readUInt24LE(data, 12),
        flags: data[15],
      });
    }

    offset = dataEnd + (length % 2);
  }

  if (offset !== buffer.length) throw new Error('invalid WebP chunk padding');
  if (!canvas) throw new Error('animated WebP is missing VP8X canvas metadata');
  if ((vp8xFlags & 0x02) === 0) throw new Error('VP8X animation flag is not set');
  if (!hasAnim) throw new Error('animated WebP is missing ANIM');
  if (frames.length < 2) throw new Error('animated WebP must contain at least two ANMF frames');
  if (canvas.width === 0 || canvas.height === 0) throw new Error('zero-sized WebP canvas');

  let totalDurationMs = 0;
  for (const [index, frame] of frames.entries()) {
    if (frame.durationMs <= 0) throw new Error(`frame ${index + 1} has a zero duration`);
    if (frame.x + frame.width > canvas.width || frame.y + frame.height > canvas.height) {
      throw new Error(`frame ${index + 1} exceeds the ${canvas.width}x${canvas.height} canvas`);
    }
    totalDurationMs += frame.durationMs;
  }

  return {
    width: canvas.width,
    height: canvas.height,
    frameCount: frames.length,
    durationMs: totalDurationMs,
    fps: frames.length / (totalDurationMs / 1000),
    frames,
  };
}

async function walkFiles(directory, root, results = []) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return results;
    throw error;
  }

  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'tmp') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(absolute, root, results);
    } else if (entry.isFile()) {
      results.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
  }
  return results;
}

function validateManifestShape(manifest) {
  if (!isObject(manifest)) {
    fail('manifest: root must be an object.');
    return;
  }
  if (manifest.schemaVersion !== 1) fail('manifest.schemaVersion must equal 1.');
  if (!isNonEmptyString(manifest.collection)) fail('manifest.collection must be a non-empty string.');

  if (!isObject(manifest.budgets)) {
    fail('manifest.budgets must be an object.');
  } else {
    for (const [key, expected] of Object.entries(EXPECTED_BUDGETS)) {
      if (manifest.budgets[key] !== expected) {
        fail(`manifest.budgets.${key} must equal ${expected}.`);
      }
    }
  }

  if (!Array.isArray(manifest.palette) || manifest.palette.length < REQUIRED_PALETTE.length || manifest.palette.length > 24) {
    fail('manifest.palette must contain 7-24 colors (24 maximum).');
  } else {
    const normalized = manifest.palette.map(normalizedHex);
    normalized.forEach((color, index) => {
      if (!color) fail(`manifest.palette[${index}] must be #RRGGBB.`);
    });
    const valid = normalized.filter(Boolean);
    if (new Set(valid).size !== valid.length) fail('manifest.palette may not contain duplicate colors.');
    const paletteSet = new Set(valid);
    for (const required of REQUIRED_PALETTE.map((color) => color.toUpperCase())) {
      if (!paletteSet.has(required)) fail(`manifest.palette is missing required color ${required}.`);
    }
  }

  if (!Array.isArray(manifest.artworks)) fail('manifest.artworks must be an array.');
}

function validateProfile(profile, manifestById) {
  if (!isObject(profile)) {
    fail('content/profile.json: root must be an object.');
    return;
  }

  const requiredIdentity = ['name', 'handle', 'role', 'class', 'volume', 'location'];
  if (!isObject(profile.identity)) {
    fail('profile.identity must be an object.');
  } else {
    for (const key of requiredIdentity) {
      if (!isNonEmptyString(profile.identity[key])) fail(`profile.identity.${key} must be a non-empty string.`);
    }
  }

  const requiredChapter = ['title', 'thread', 'state', 'footer'];
  if (!isObject(profile.chapter)) {
    fail('profile.chapter must be an object.');
  } else {
    for (const key of requiredChapter) {
      if (!isNonEmptyString(profile.chapter[key])) fail(`profile.chapter.${key} must be a non-empty string.`);
    }
  }

  const expectedArtworkBlock = {
    manifest: 'assets/artbook-v3/manifest.json',
    hero: 'hero',
    atlas: 'atlas',
    workshop: 'workshop',
  };
  if (!isObject(profile.artwork)) {
    fail('profile.artwork must be an object containing manifest, hero, atlas, and workshop references.');
  } else {
    for (const [key, expected] of Object.entries(expectedArtworkBlock)) {
      if (profile.artwork[key] !== expected) fail(`profile.artwork.${key} must equal ${JSON.stringify(expected)}.`);
      if (key !== 'manifest' && !manifestById.has(expected)) fail(`profile.artwork.${key} references missing manifest artwork ${expected}.`);
    }
  }

  if (!isObject(profile.heroPortrait) || profile.heroPortrait.path !== 'assets/avatar/avatar-orb-mask-512.png') {
    fail('profile.heroPortrait must remain exactly { path: "assets/avatar/avatar-orb-mask-512.png" }.');
  }

  if (!Array.isArray(profile.worlds) || profile.worlds.length !== WORLD_IDS.length) {
    fail(`profile.worlds must contain exactly ${WORLD_IDS.length} worlds.`);
  } else {
    const slugs = new Set();
    const ids = new Set();
    for (const [index, world] of profile.worlds.entries()) {
      const label = `profile.worlds[${index}]`;
      if (!isObject(world)) {
        fail(`${label} must be an object.`);
        continue;
      }
      for (const key of ['id', 'slug', 'title', 'discipline', 'summary', 'visitor', 'motif']) {
        if (!isNonEmptyString(world[key])) fail(`${label}.${key} must be a non-empty string.`);
      }
      if (ids.has(world.id)) fail(`${label}.id duplicates ${world.id}.`);
      if (slugs.has(world.slug)) fail(`${label}.slug duplicates ${world.slug}.`);
      ids.add(world.id);
      slugs.add(world.slug);

      if (world.artworkId !== world.slug) fail(`${label}.artworkId must exactly match its slug.`);
      if (!manifestById.has(world.artworkId)) fail(`${label}.artworkId references missing manifest artwork ${world.artworkId}.`);
      if (!Array.isArray(world.decisions) || world.decisions.length === 0 || world.decisions.some((item) => !isNonEmptyString(item))) {
        fail(`${label}.decisions must be a non-empty array of strings.`);
      }
      if (!isObject(world.evidence)) {
        fail(`${label}.evidence must be an object.`);
      } else {
        const expectedKind = index < 4 ? 'case-study' : 'live-only';
        if (world.evidence.kind !== expectedKind) fail(`${label}.evidence.kind must equal ${expectedKind}.`);
        if (!isHttpsUrl(world.evidence.live)) fail(`${label}.evidence.live must be an HTTPS URL.`);
        if (expectedKind === 'case-study' && !isHttpsUrl(world.evidence.caseStudy)) fail(`${label}.evidence.caseStudy must be an HTTPS URL.`);
        if (expectedKind === 'live-only' && !isHttpsUrl(world.evidence.portfolio)) fail(`${label}.evidence.portfolio must be an HTTPS URL.`);
      }
    }

    for (const expected of WORLD_IDS) {
      if (!slugs.has(expected)) fail(`profile.worlds is missing required slug ${expected}.`);
    }
  }

  if (!isObject(profile.method)) {
    fail('profile.method must be an object.');
  } else {
    if (!Array.isArray(profile.method.stages) || profile.method.stages.length !== 6 || profile.method.stages.some((item) => !isNonEmptyString(item))) {
      fail('profile.method.stages must contain exactly six non-empty strings.');
    }
    if (!Array.isArray(profile.method.disciplines) || profile.method.disciplines.length !== 3) {
      fail('profile.method.disciplines must contain exactly three disciplines.');
    }
    if (!Array.isArray(profile.method.principles) || profile.method.principles.length !== 3 || profile.method.principles.some((item) => !isNonEmptyString(item))) {
      fail('profile.method.principles must contain exactly three non-empty strings.');
    }
  }
  if (!Array.isArray(profile.fieldNotes) || profile.fieldNotes.length !== 3) fail('profile.fieldNotes must contain exactly three notes.');
  if (!Array.isArray(profile.inventory) || profile.inventory.length === 0) fail('profile.inventory must be a non-empty array.');
  if (!isObject(profile.links) || !isHttpsUrl(profile.links.portfolio) || !isHttpsUrl(profile.links.linkedin)) {
    fail('profile.links must contain HTTPS portfolio and linkedin URLs.');
  }
  if (!isNonEmptyString(profile.signature)) fail('profile.signature must be a non-empty string.');
}

function normalizeReadmeImagePath(rawPath) {
  let value = rawPath.trim();
  if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1);
  if (/^(?:https?:)?\/\//i.test(value) || /^data:/i.test(value)) return { external: true, value };
  if (value.includes('?') || value.includes('#') || value.includes('%')) return { invalid: true, value };
  value = value.replace(/^\.\//, '');
  const normalized = path.posix.normalize(value);
  return { external: false, invalid: normalized.startsWith('../') || normalized === '..', value: normalized };
}

function validateReadme(readme, manifestById, fileToArtwork) {
  const clean = stripMarkdownComments(readme);
  if (Buffer.byteLength(readme, 'utf8') >= 500 * KiB) {
    fail(`README.md must be smaller than 500 KiB; found ${formatBytes(Buffer.byteLength(readme, 'utf8'))}.`);
  }

  const bannedPatterns = [
    ['Shields', /shields\.io/i],
    ['GitHub Readme Stats', /github-readme-stats/i],
    ['streak widget', /github-readme-streak-stats|streak-stats/i],
    ['typing widget', /readme-typing-svg|typing-svg/i],
    ['visitor counter', /komarev|visitor[-_ ]?badge|visitor[-_ ]?count/i],
    ['Capsule Render', /capsule-render/i],
    ['snake animation', /snk|github-contribution-grid-snake/i],
    ['trophy widget', /github-profile-trophy/i],
  ];
  for (const [name, pattern] of bannedPatterns) {
    if (pattern.test(clean)) fail(`README.md contains banned ${name} markup.`);
  }
  if (/\b(?:no vanity(?: metrics)?|dark mode)\b/i.test(clean)) {
    fail('README.md contains a banned self-referential design claim.');
  }
  const visibleMarkdownCopy = clean.replace(/<[^>]+>/g, '');
  if (/\b\d{1,3}\s*%/.test(visibleMarkdownCopy)) {
    fail('README.md contains a percentage; V3 does not publish unverified progress metrics.');
  }
  if (/<(?:script|iframe)\b/i.test(clean)) fail('README.md may not contain script or iframe elements.');

  const referencedPaths = new Set();
  const pictureRanges = [];
  const picturePattern = /<picture\b[^>]*>[\s\S]*?<\/picture>/gi;
  for (const match of clean.matchAll(picturePattern)) {
    const block = match[0];
    pictureRanges.push([match.index, match.index + block.length]);
    const imgTags = [...block.matchAll(/<img\b[^>]*>/gi)].map((item) => item[0]);
    const sourceTags = [...block.matchAll(/<source\b[^>]*>/gi)].map((item) => item[0]);
    if (imgTags.length !== 1) {
      fail('<picture> must contain exactly one fallback <img>.');
      continue;
    }

    const img = imgTags[0];
    const alt = getAttr(img, 'alt');
    const fallbackSrc = getAttr(img, 'src');
    if (!isNonEmptyString(alt)) fail('<picture> fallback <img> must have meaningful alt text.');
    if (!isNonEmptyString(fallbackSrc)) {
      fail('<picture> fallback <img> must have src.');
      continue;
    }

    const candidates = [{ raw: fallbackSrc, tag: img, role: 'fallback' }];
    for (const source of sourceTags) {
      for (const candidate of srcsetPaths(getAttr(source, 'srcset'))) {
        candidates.push({ raw: candidate, tag: source, role: 'source' });
      }
    }

    const artworkIds = new Set();
    for (const candidate of candidates) {
      const parsed = normalizeReadmeImagePath(candidate.raw);
      if (parsed.external) {
        fail(`README.md contains external image source: ${parsed.value}`);
        continue;
      }
      if (parsed.invalid) {
        fail(`README.md contains unsafe/noncanonical image source: ${parsed.value}`);
        continue;
      }
      referencedPaths.add(parsed.value);
      if (/\.svg$/i.test(parsed.value)) fail(`README.md references forbidden SVG: ${parsed.value}`);
      const artworkId = fileToArtwork.get(parsed.value);
      if (!artworkId) fail(`README.md references image not declared in manifest: ${parsed.value}`);
      else artworkIds.add(artworkId);
    }

    if (artworkIds.size > 1) fail(`<picture> mixes files from multiple artworks: ${[...artworkIds].join(', ')}.`);
    const artworkId = [...artworkIds][0];
    const artwork = manifestById.get(artworkId);
    if (COVER_IDS.includes(artworkId)) fail(`README.md profile may not embed case-study cover artwork ${artworkId}.`);
    if (artwork && alt !== artwork.alt) {
      fail(`<picture> for ${artworkId} must use manifest alt text exactly.`);
    }

    if (artwork?.files?.animated) {
      const staticPath = artwork.files.static.path;
      const animatedPath = artwork.files.animated.path;
      const reducedIndex = sourceTags.findIndex((tag) => {
        const media = getAttr(tag, 'media') ?? '';
        return /prefers-reduced-motion\s*:\s*reduce/i.test(media)
          && srcsetPaths(getAttr(tag, 'srcset')).some((value) => normalizeReadmeImagePath(value).value === staticPath);
      });
      const animatedIndex = sourceTags.findIndex((tag) => srcsetPaths(getAttr(tag, 'srcset')).some((value) => normalizeReadmeImagePath(value).value === animatedPath));
      const animatedIsNoPreferenceOnly = animatedIndex >= 0
        && /prefers-reduced-motion\s*:\s*no-preference/i.test(getAttr(sourceTags[animatedIndex], 'media') ?? '');
      // Either an explicit reduced-motion source precedes the animation, or
      // the animation itself is gated behind no-preference so the static img
      // fallback is selected automatically when motion is reduced.
      if (reducedIndex < 0 && !animatedIsNoPreferenceOnly) {
        fail(`<picture> for ${artworkId} must explicitly serve static PNG for reduced motion or gate WebP behind no-preference.`);
      }
      if (animatedIndex < 0) fail(`<picture> for ${artworkId} must reference its animated WebP.`);
      if (reducedIndex >= 0 && animatedIndex >= 0 && reducedIndex > animatedIndex) {
        fail(`<picture> for ${artworkId} must place reduced-motion PNG before animated WebP.`);
      }
      if (normalizeReadmeImagePath(fallbackSrc).value !== staticPath) {
        fail(`<picture> for ${artworkId} must use its static PNG as fallback <img src>.`);
      }
    }
  }

  const isInsidePicture = (index) => pictureRanges.some(([start, end]) => index >= start && index < end);
  for (const match of clean.matchAll(/!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g)) {
    if (isInsidePicture(match.index)) continue;
    const alt = match[1];
    const raw = match[2] ?? match[3];
    if (!isNonEmptyString(alt)) fail(`Markdown image ${raw} must have meaningful alt text.`);
    const parsed = normalizeReadmeImagePath(raw);
    if (parsed.external) {
      fail(`README.md contains external image source: ${parsed.value}`);
      continue;
    }
    if (parsed.invalid) {
      fail(`README.md contains unsafe/noncanonical image source: ${parsed.value}`);
      continue;
    }
    referencedPaths.add(parsed.value);
    if (/\.svg$/i.test(parsed.value)) fail(`README.md references forbidden SVG: ${parsed.value}`);
    const artworkId = fileToArtwork.get(parsed.value);
    if (!artworkId) fail(`README.md references image not declared in manifest: ${parsed.value}`);
    else {
      if (COVER_IDS.includes(artworkId)) fail(`README.md profile may not embed case-study cover artwork ${artworkId}.`);
      if (alt !== manifestById.get(artworkId).alt) fail(`Markdown image for ${artworkId} must use manifest alt text exactly.`);
    }
  }

  // Catch standalone HTML img/source elements not already accounted for by pictures.
  for (const match of clean.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    if (isInsidePicture(match.index)) continue;
    const tag = match[0];
    const tagName = /^<img/i.test(tag) ? 'img' : 'source';
    const paths = tagName === 'img' ? [getAttr(tag, 'src')].filter(Boolean) : srcsetPaths(getAttr(tag, 'srcset'));
    if (tagName === 'img' && !isNonEmptyString(getAttr(tag, 'alt'))) fail('Standalone <img> must have meaningful alt text.');
    for (const raw of paths) {
      const parsed = normalizeReadmeImagePath(raw);
      if (parsed.external) fail(`README.md contains external image source: ${parsed.value}`);
      else if (parsed.invalid) fail(`README.md contains unsafe/noncanonical image source: ${parsed.value}`);
      else {
        referencedPaths.add(parsed.value);
        if (!fileToArtwork.has(parsed.value)) fail(`README.md references image not declared in manifest: ${parsed.value}`);
      }
    }
  }

  for (const [id, artwork] of manifestById) {
    if (COVER_IDS.includes(id)) continue;
    for (const descriptor of Object.values(artwork.files)) {
      if (!referencedPaths.has(descriptor.path)) fail(`README.md does not reference manifest file ${descriptor.path}.`);
    }
  }
}

async function main() {
  const root = findRepoRoot();
  const manifestPath = path.join(root, 'assets', 'artbook-v3', 'manifest.json');
  const profilePath = path.join(root, 'content', 'profile.json');
  const readmePath = path.join(root, 'README.md');

  let manifest;
  let profile;
  let readme;
  try {
    [manifest, profile, readme] = await Promise.all([
      readFile(manifestPath, 'utf8').then(JSON.parse),
      readFile(profilePath, 'utf8').then(JSON.parse),
      readFile(readmePath, 'utf8'),
    ]);
  } catch (error) {
    throw new Error(`Could not read required V3 inputs: ${error.message}`);
  }

  validateManifestShape(manifest);
  const manifestById = new Map();
  const fileToArtwork = new Map();
  const actualFilesByPath = new Map();
  const globalPalette = new Set(
    Array.isArray(manifest.palette)
      ? manifest.palette.map(normalizedHex).filter(Boolean)
      : [],
  );

  if (Array.isArray(manifest.artworks)) {
    for (const [index, artwork] of manifest.artworks.entries()) {
      const label = `manifest.artworks[${index}]`;
      if (!isObject(artwork)) {
        fail(`${label} must be an object.`);
        continue;
      }
      if (!isNonEmptyString(artwork.id)) {
        fail(`${label}.id must be a non-empty string.`);
        continue;
      }
      if (manifestById.has(artwork.id)) fail(`${label}.id duplicates ${artwork.id}.`);
      manifestById.set(artwork.id, artwork);
      if (!isNonEmptyString(artwork.project)) fail(`${label}.project must be a non-empty string.`);
      if (!isNonEmptyString(artwork.alt) || artwork.alt.trim().length < 20) {
        fail(`${label}.alt must be meaningful (at least 20 characters).`);
      }
      if (typeof artwork.alt === 'string' && artwork.alt.length > 320) fail(`${label}.alt must be at most 320 characters.`);

      const expected = EXPECTED_ARTWORKS.get(artwork.id);
      if (!expected) {
        fail(`${label}.id is unexpected: ${artwork.id}.`);
        continue;
      }
      if (!isObject(artwork.files)) {
        fail(`${label}.files must be an object.`);
        continue;
      }
      for (const required of expected.required) {
        if (!isObject(artwork.files[required])) fail(`${label}.files.${required} is required.`);
      }
      for (const key of Object.keys(artwork.files)) {
        if (!expected.allowed.includes(key)) fail(`${label}.files.${key} is not allowed for ${artwork.id}.`);
      }

      for (const [variant, descriptor] of Object.entries(artwork.files)) {
        const fileLabel = `${label}.files.${variant}`;
        if (!isObject(descriptor)) continue;
        const expectedMime = variant === 'animated' ? 'image/webp' : 'image/png';
        const expectedExtension = variant === 'animated' ? '.webp' : '.png';
        if (descriptor.mime !== expectedMime) fail(`${fileLabel}.mime must equal ${expectedMime}.`);
        if (!Number.isInteger(descriptor.width) || descriptor.width <= 0) fail(`${fileLabel}.width must be a positive integer.`);
        if (!Number.isInteger(descriptor.height) || descriptor.height <= 0) fail(`${fileLabel}.height must be a positive integer.`);
        if (!Number.isInteger(descriptor.bytes) || descriptor.bytes <= 0) fail(`${fileLabel}.bytes must be a positive integer.`);
        if (typeof descriptor.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(descriptor.sha256)) fail(`${fileLabel}.sha256 must be 64 hexadecimal characters.`);
        if (typeof descriptor.path === 'string' && path.posix.extname(descriptor.path).toLowerCase() !== expectedExtension) {
          fail(`${fileLabel}.path must use ${expectedExtension}.`);
        }

        const dimensions = expected.dimensions[variant];
        if (dimensions) {
          const [expectedWidth, expectedHeight] = dimensions;
          if (descriptor.width !== expectedWidth) fail(`${fileLabel}.width must equal ${expectedWidth}.`);
          if (expectedHeight !== null && descriptor.height !== expectedHeight) fail(`${fileLabel}.height must equal ${expectedHeight}.`);
          if (artwork.id === 'workshop' && (descriptor.height < 300 || descriptor.height > 480)) {
            fail(`${fileLabel}.height must be between 300 and 480 pixels for the compact workshop plate.`);
          }
        }

        if (variant === 'animated') {
          if (!Number.isInteger(descriptor.frameCount) || descriptor.frameCount < 2) fail(`${fileLabel}.frameCount must be an integer of at least 2.`);
          if (!Number.isInteger(descriptor.durationMs) || descriptor.durationMs < 3000 || descriptor.durationMs > 4000) {
            fail(`${fileLabel}.durationMs must be an integer from 3000 to 4000.`);
          }
          if (typeof descriptor.fps !== 'number' || !Number.isFinite(descriptor.fps) || descriptor.fps < 4 || descriptor.fps > 6) {
            fail(`${fileLabel}.fps must be a finite number from 4 to 6.`);
          }
          if (descriptor.bytes > EXPECTED_BUDGETS.animatedMaxBytes) {
            fail(`${fileLabel} exceeds animated budget: ${formatBytes(descriptor.bytes)} > ${formatBytes(EXPECTED_BUDGETS.animatedMaxBytes)}.`);
          }
        } else if (descriptor.bytes > EXPECTED_BUDGETS.staticMaxBytes) {
          fail(`${fileLabel} exceeds static budget: ${formatBytes(descriptor.bytes)} > ${formatBytes(EXPECTED_BUDGETS.staticMaxBytes)}.`);
        }

        const absolute = localPathFromManifest(root, descriptor.path, fileLabel);
        if (!absolute) continue;
        if (fileToArtwork.has(descriptor.path)) fail(`${fileLabel}.path duplicates another manifest file: ${descriptor.path}.`);
        fileToArtwork.set(descriptor.path, artwork.id);

        try {
          const [buffer, fileStat] = await Promise.all([readFile(absolute), stat(absolute)]);
          if (!fileStat.isFile()) throw new Error('not a regular file');
          const digest = createHash('sha256').update(buffer).digest('hex');
          if (buffer.length !== descriptor.bytes) fail(`${fileLabel}.bytes says ${descriptor.bytes}; actual file is ${buffer.length}.`);
          if (digest !== descriptor.sha256.toLowerCase()) fail(`${fileLabel}.sha256 does not match file content.`);

          if (variant === 'animated') {
            const parsed = parseAnimatedWebp(buffer);
            if (parsed.width !== descriptor.width || parsed.height !== descriptor.height) fail(`${fileLabel} WebP canvas is ${parsed.width}x${parsed.height}, not manifest ${descriptor.width}x${descriptor.height}.`);
            if (parsed.frameCount !== descriptor.frameCount) fail(`${fileLabel} has ${parsed.frameCount} frames, not manifest ${descriptor.frameCount}.`);
            if (parsed.durationMs !== descriptor.durationMs) fail(`${fileLabel} lasts ${parsed.durationMs}ms, not manifest ${descriptor.durationMs}ms.`);
            if (Math.abs(parsed.fps - descriptor.fps) > 0.01) fail(`${fileLabel} runs at ${parsed.fps.toFixed(3)}fps, not manifest ${descriptor.fps}.`);
            if (parsed.fps < 4 || parsed.fps > 6) fail(`${fileLabel} actual frame rate ${parsed.fps.toFixed(3)}fps is outside 4-6fps.`);
            actualFilesByPath.set(descriptor.path, { bytes: buffer.length, ...parsed });
          } else {
            const parsed = parsePng(buffer);
            if (parsed.width !== descriptor.width || parsed.height !== descriptor.height) fail(`${fileLabel} PNG is ${parsed.width}x${parsed.height}, not manifest ${descriptor.width}x${descriptor.height}.`);
            if (parsed.usedColors.length > 24) fail(`${fileLabel} uses ${parsed.usedColors.length} colors; maximum is 24.`);
            for (const [colorIndex, color] of parsed.usedColors.entries()) {
              if (!globalPalette.has(color)) {
                fail(`${fileLabel} uses ${color} at PLTE index ${parsed.usedPaletteIndices[colorIndex]}, which is absent from manifest.palette.`);
              }
            }
            actualFilesByPath.set(descriptor.path, { bytes: buffer.length, ...parsed });
          }
        } catch (error) {
          fail(`${fileLabel} could not be validated (${descriptor.path}): ${error.message}`);
        }
      }
    }
  }

  for (const id of EXPECTED_ARTWORKS.keys()) {
    if (!manifestById.has(id)) fail(`manifest.artworks is missing required artwork ${id}.`);
  }

  validateProfile(profile, manifestById);
  validateReadme(readme, manifestById, fileToArtwork);

  const repositoryFiles = await walkFiles(root, root);
  for (const file of repositoryFiles) {
    if (/\.svg$/i.test(file)) fail(`SVG files are forbidden in V3: ${file}.`);
  }

  const actualArtFiles = repositoryFiles.filter((file) => /^assets\/artbook-v3\/.*\.(?:png|webp)$/i.test(file));
  const unexpectedArtbookFiles = repositoryFiles.filter((file) => (
    file.startsWith('assets/artbook-v3/')
    && file !== 'assets/artbook-v3/manifest.json'
    && !/\.(?:png|webp)$/i.test(file)
  ));
  for (const file of unexpectedArtbookFiles) fail(`Unexpected file type in assets/artbook-v3/: ${file}.`);
  for (const file of actualArtFiles) {
    if (!fileToArtwork.has(file)) fail(`Raster art file is not declared in manifest: ${file}.`);
  }
  for (const file of fileToArtwork.keys()) {
    if (!actualArtFiles.includes(file)) fail(`Manifest file is absent from assets/artbook-v3 scan: ${file}.`);
  }

  let effectiveBytes = 0;
  const hero = manifestById.get('hero');
  const atlas = manifestById.get('atlas');
  const workshop = manifestById.get('workshop');
  if (hero?.files?.static && hero?.files?.mobile) effectiveBytes += Math.max(hero.files.static.bytes, hero.files.mobile.bytes);
  if (atlas?.files?.static && atlas?.files?.mobile) effectiveBytes += Math.max(atlas.files.static.bytes, atlas.files.mobile.bytes);
  for (const id of WORLD_IDS) {
    const artwork = manifestById.get(id);
    if (artwork?.files?.animated) effectiveBytes += artwork.files.animated.bytes;
    else if (artwork?.files?.static) effectiveBytes += artwork.files.static.bytes;
  }
  if (workshop?.files?.static) effectiveBytes += workshop.files.static.bytes;
  if (effectiveBytes > EXPECTED_BUDGETS.effectiveMaxBytes) {
    fail(`Effective profile art payload is ${formatBytes(effectiveBytes)}; maximum is ${formatBytes(EXPECTED_BUDGETS.effectiveMaxBytes)}.`);
  }

  const referencedAnimatedWorlds = WORLD_IDS.filter((id) => manifestById.get(id)?.files?.animated).length;
  if (referencedAnimatedWorlds < WORLD_IDS.length) {
    warn(`${WORLD_IDS.length - referencedAnimatedWorlds} world(s) use the allowed static-only fallback.`);
  }

  if (warnings.length) {
    console.warn(`\nWarnings (${warnings.length}):`);
    warnings.forEach((message) => console.warn(`  - ${message}`));
  }
  if (errors.length) {
    console.error(`\nAtlantic Pixel Artbook V3 validation failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
    errors.forEach((message) => console.error(`  - ${message}`));
    process.exitCode = 1;
    return;
  }

  console.log('Atlantic Pixel Artbook V3 validation passed.');
  console.log(`  ${manifestById.size} artworks · ${fileToArtwork.size} files · ${formatBytes(effectiveBytes)} effective payload`);
  console.log(`  ${WORLD_IDS.length} worlds · ${referencedAnimatedWorlds} animated · ${globalPalette.size} master colors`);
}

main().catch((error) => {
  console.error(`Atlantic Pixel Artbook V3 validator crashed: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
