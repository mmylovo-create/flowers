// Temporary illustrated "photos" for a sample shop, so the template looks finished
// before the owner's real photos arrive. Real photos placed in tenants/<slug>/photos/ win:
// existing files are never overwritten unless --force is passed.
// Usage: pnpm tsx scripts/make-sample-photos.ts <slug> [--force]
import sharp from 'sharp';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTenant, tenantDir } from './lib/tenants.ts';

type Palette = { bg: [string, string]; flowers: string[]; centre: string; wrap: string; leaf: string };
const PALETTES: Palette[] = [
  { bg: ['#FCEFF1', '#F6DCE3'], flowers: ['#F4A7B9', '#F7C1CC', '#EE8FA6', '#FAD4DC'], centre: '#F9E3A3', wrap: '#D9C3A5', leaf: '#8FB59A' },
  { bg: ['#FFF4EC', '#FBE3D6'], flowers: ['#F8C3A6', '#F4A98C', '#FBD9C4', '#F7B7B0'], centre: '#F3D27A', wrap: '#EAD9C6', leaf: '#9CBF94' },
  { bg: ['#F3EEFB', '#E6DCF5'], flowers: ['#C7B3E6', '#B39DDB', '#DCCDF2', '#A68FD0'], centre: '#F5E6A8', wrap: '#E4DDEB', leaf: '#97B8A0' },
  { bg: ['#F5F7F2', '#E7EDE1'], flowers: ['#FFFFFF', '#F7F5EE', '#FBFAF6', '#EFEDE4'], centre: '#E9D98B', wrap: '#CFE0CF', leaf: '#7FA88A' },
  { bg: ['#FFF1E8', '#F9DCCB'], flowers: ['#F7B79A', '#F9CDB5', '#F2A08A', '#FBE0D0'], centre: '#F2C66B', wrap: '#E8C9B8', leaf: '#9AB991' },
  { bg: ['#F1F6FB', '#E1ECF6'], flowers: ['#FFFFFF', '#A9C8EC', '#F9E27D', '#C9DDF2'], centre: '#F2C14E', wrap: '#E3D5BF', leaf: '#8DB78F' },
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function flower(x: number, y: number, r: number, color: string, centre: string, rot: number, petals: number) {
  let out = `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)})">`;
  for (let i = 0; i < petals; i++) {
    out += `<ellipse cx="0" cy="${(-r * 0.55).toFixed(1)}" rx="${(r * 0.42).toFixed(1)}" ry="${(r * 0.62).toFixed(1)}" fill="${color}" stroke="rgba(120,60,80,.12)" stroke-width="1.5" transform="rotate(${(360 / petals) * i})"/>`;
  }
  out += `<circle r="${(r * 0.26).toFixed(1)}" fill="${centre}"/><circle r="${(r * 0.12).toFixed(1)}" fill="rgba(140,90,40,.35)"/></g>`;
  return out;
}

function bouquetSvg(w: number, h: number, pal: Palette, seed: number, cx = w / 2) {
  const R = rng(seed);
  const scale = Math.min(w, h) / 800;
  let leaves = '';
  for (let i = 0; i < 14; i++) {
    const a = -Math.PI / 2 + (R() - 0.5) * 2.4;
    const len = (180 + R() * 120) * scale;
    const x = cx + Math.cos(a) * len * 0.9;
    const y = h * 0.47 + Math.sin(a) * len * 0.75;
    leaves += `<ellipse cx="${x}" cy="${y}" rx="${26 * scale}" ry="${70 * scale}" fill="${pal.leaf}" opacity=".85" transform="rotate(${(a * 180) / Math.PI + 90} ${x} ${y})"/>`;
  }
  let flowers = '';
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2;
    const d = Math.sqrt(R()) * 170 * scale;
    const x = cx + Math.cos(a) * d * 1.15;
    const y = h * 0.42 + Math.sin(a) * d * 0.8;
    flowers += flower(x, y, (58 + R() * 34) * scale, pal.flowers[i % pal.flowers.length], pal.centre, R() * 360, 5 + Math.floor(R() * 4));
  }
  const top = h * 0.55;
  const wrap = `<path d="M ${cx - 230 * scale} ${top} L ${cx + 230 * scale} ${top} L ${cx + 60 * scale} ${h * 0.97} L ${cx - 60 * scale} ${h * 0.97} Z" fill="${pal.wrap}"/>
    <path d="M ${cx - 230 * scale} ${top} L ${cx} ${h * 0.97} L ${cx - 60 * scale} ${h * 0.97} Z" fill="rgba(255,255,255,.25)"/>
    <g transform="translate(${cx} ${h * 0.72}) scale(${scale})" fill="${pal.flowers[2]}" stroke="rgba(120,60,80,.18)" stroke-width="2">
      <path d="M0 0 C -40 -40 -90 -30 -80 0 C -90 30 -40 40 0 0 Z"/><path d="M0 0 C 40 -40 90 -30 80 0 C 90 30 40 40 0 0 Z"/>
      <path d="M-6 4 L -30 70 L -14 64 L 0 8 Z"/><path d="M6 4 L 30 70 L 14 64 L 0 8 Z"/><circle r="12"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal.bg[0]}"/><stop offset="1" stop-color="${pal.bg[1]}"/></linearGradient>
    <radialGradient id="glow" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#glow)"/>
    ${leaves}${wrap}${flowers}
  </svg>`;
}

function logoSvg(name: string, accent: string) {
  const letter = name.trim()[0]?.toUpperCase() ?? '✿';
  let petals = '';
  for (let i = 0; i < 6; i++) petals += `<ellipse cx="256" cy="150" rx="62" ry="104" fill="${accent}" opacity=".22" transform="rotate(${i * 60} 256 256)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#FFF8F6"/>${petals}
    <text x="256" y="318" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="210" fill="${accent}">${letter}</text></svg>`;
}

export async function makeSamplePhotos(slug: string, force = false) {
  const t = loadTenant(slug);
  const dir = tenantDir(slug);
  const made: string[] = [];
  const write = async (rel: string, svg: string, w: number, h: number) => {
    const p = join(dir, rel);
    if (existsSync(p) && !force) return;
    mkdirSync(join(p, '..'), { recursive: true });
    if (rel.endsWith('.svg')) writeFileSync(p, svg);
    else await sharp(Buffer.from(svg)).resize(w, h).jpeg({ quality: 84, mozjpeg: true }).toFile(p);
    made.push(rel);
  };
  if (!/^https?:/.test(t.settings.heroPhoto)) {
    await write(t.settings.heroPhoto, bouquetSvg(1600, 1200, PALETTES[0], 7, 800), 1600, 1200);
  }
  if (t.settings.logo && !/^https?:/.test(t.settings.logo)) {
    if (t.settings.logo.endsWith('.svg')) await write(t.settings.logo, logoSvg(t.settings.name, t.settings.theme.accent), 512, 512);
    else await write(t.settings.logo, logoSvg(t.settings.name, t.settings.theme.accent), 512, 512);
  }
  let i = 0;
  for (const b of t.bouquets) {
    if (!/^https?:/.test(b.photo)) await write(b.photo, bouquetSvg(900, 900, PALETTES[i % PALETTES.length], 31 + i * 17), 900, 900);
    i++;
  }
  return made;
}

if (import.meta.filename === process.argv[1]) {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: pnpm tsx scripts/make-sample-photos.ts <slug> [--force]');
    process.exit(1);
  }
  const made = await makeSamplePhotos(slug, process.argv.includes('--force'));
  console.log(made.length ? `Created: ${made.join(', ')}` : 'All photos already exist — nothing replaced.');
}
