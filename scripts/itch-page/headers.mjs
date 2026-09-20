// Renders the description's section headers as transparent PNGs in the game's tab style:
// a flat-right half-pill in the night accent, its shadow leaned under it, Young Serif on top.
// Run: node scripts/itch-page/headers.mjs  (needs Edge; writes build/itch-page/headers/*.png)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = join(ROOT, 'build/itch-page/headers');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const FONT = pathToFileURL(join(ROOT, 'node_modules/@fontsource/young-serif/files/young-serif-latin-400-normal.woff2')).href;
const SCALE = 2; // the column is 873 css px wide; itch shows the png at half its pixels
const HEADERS = {
  'do-and-say-anything': 'Do and say anything',
  'manage-university-life': 'Manage university life',
  'design-your-dream-girl': 'Design your dream girl',
  'optional-adult-content': 'Optional adult content',
};

const page = (text) => `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: 'Young Serif'; src: url('${FONT}') format('woff2'); }
html, body { margin: 0; background: transparent; }
body { padding: 40px 60px; display: inline-block; }
.tab { position: relative; isolation: isolate; display: inline-block; rotate: -2deg;
  padding: 14px 34px 14px 44px; border-radius: 999px 0 0 999px;
  color: #2a1424; font: 400 30px/1.2 'Young Serif', serif; white-space: nowrap; }
.tab::before, .tab::after { content: ''; position: absolute; inset: 0; border-radius: inherit; }
.tab::after { z-index: -1; background: #d795b4; }
.tab::before { z-index: -2; background: #150e18; translate: 9px 7px; rotate: -2deg; }
</style><body><div class="tab">${text}</div></body>`;

mkdirSync(OUT, { recursive: true });
for (const [name, text] of Object.entries(HEADERS)) {
  const html = join(OUT, `${name}.html`);
  const shot = join(OUT, `${name}.raw.png`);
  writeFileSync(html, page(text));
  execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    `--force-device-scale-factor=${SCALE}`, '--default-background-color=00000000',
    '--window-size=1000,200', `--screenshot=${shot}`, pathToFileURL(html).href,
  ], { stdio: 'ignore' });
  const img = sharp(shot).trim({ threshold: 1 });
  const buf = await sharp(await img.extend({ top: 0, bottom: 0, left: 0, right: 0 }).png().toBuffer()).toBuffer();
  await sharp(buf).extend({ top: 8, bottom: 8, left: 8, right: 8, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toFile(join(OUT, `${name}.png`));
  unlinkSync(html); unlinkSync(shot);
  const meta = await sharp(join(OUT, `${name}.png`)).metadata();
  console.log(name, meta.width, meta.height);
}
