// בונה את public/library/index.json מכל קבצי התמונה שבתיקייה public/library (כולל תיקיות משנה).
// שם הקובץ (ושם התיקייה) הם מילות החיפוש: kidney_nephron.png  ->  kidney, nephron
// פרטי קרדיט (אופציונלי) מתוך public/library/credits.csv: file,author,license,source
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = 'public/library';
const EXT = /\.(png|jpe?g|webp|gif)$/i;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_')) continue; // _web / _thumbs נוצרים אוטומטית
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

/** CSV פשוט עם תמיכה בגרשיים; מתעלם מ-BOM של Excel */
function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const credits = new Map();
const csvPath = path.join(root, 'credits.csv');
if (fs.existsSync(csvPath)) {
  const [head, ...rows] = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const idx = (n) => head.findIndex((h) => h.trim().toLowerCase() === n);
  const [fi, ai, li, si] = ['file', 'author', 'license', 'source'].map(idx);
  for (const r of rows) {
    if (fi < 0 || !r[fi]?.trim()) continue;
    credits.set(r[fi].trim().split('\\').join('/'), {
      author: ai >= 0 ? r[ai]?.trim() : '',
      license: li >= 0 ? r[li]?.trim() : '',
      source: si >= 0 ? r[si]?.trim() : '',
    });
  }
}

const tokens = (s) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2 && !/^\d+$/.test(t));
const pretty = (s) => s.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

/** גרסת אתר (WebP עד 2000px) לשימוש במבחן, וממוזערת (JPEG 480px) לתצוגת החיפוש — בלי לגעת במקור */
async function derive(p, rel) {
  const base = rel.replace(EXT, '');
  const webRel = '_web/' + base + '.webp';
  const thumbRel = '_thumbs/' + base + '.jpg';
  const webAbs = path.join(root, webRel);
  const thumbAbs = path.join(root, thumbRel);
  const srcTime = fs.statSync(p).mtimeMs;
  const fresh = (f) => fs.existsSync(f) && fs.statSync(f).mtimeMs >= srcTime;
  const meta = await sharp(p).metadata();
  const input = () => sharp(p, { animated: false }).rotate().flatten({ background: '#ffffff' });
  if (!fresh(webAbs)) {
    fs.mkdirSync(path.dirname(webAbs), { recursive: true });
    await input().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toFile(webAbs);
  }
  if (!fresh(thumbAbs)) {
    fs.mkdirSync(path.dirname(thumbAbs), { recursive: true });
    await input().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toFile(thumbAbs);
  }
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const sc = Math.min(1, 2000 / Math.max(w, h, 1));
  return { web: webRel, thumb: thumbRel, w: Math.round(w * sc), h: Math.round(h * sc) };
}

const items = [];
for (const p of fs.existsSync(root) ? walk(root).sort() : []) {
  {
    {
      const rel = path.relative(root, p).split(path.sep).join('/');
      const c = credits.get(rel) || credits.get(path.basename(rel)) || {};
      const folders = rel.split('/').slice(0, -1);
      let derived = {};
      try {
        derived = await derive(p, rel);
      } catch (e) {
        console.warn('דילוג על קובץ שלא ניתן לעיבוד:', rel, e.message);
        continue;
      }
      items.push({
        file: rel,
        ...derived,
        title: pretty(path.basename(rel)),
        keywords: [...new Set(tokens(folders.join(' ') + ' ' + path.basename(rel).replace(EXT, '')))],
        ...(c.author ? { author: c.author } : {}),
        ...(c.license ? { license: c.license } : {}),
        ...(c.source ? { source: c.source } : {}),
      });
    }
  }
}

// מנקים גרסאות נגזרות של תמונות שנמחקו או שונו להן שם
const keep = new Set(items.flatMap((i) => [path.join(root, i.web), path.join(root, i.thumb)].map((x) => path.resolve(x))));
for (const d of ['_web', '_thumbs']) {
  const dirAbs = path.join(root, d);
  if (!fs.existsSync(dirAbs)) continue;
  (function clean(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        clean(p);
        if (!fs.readdirSync(p).length) fs.rmdirSync(p);
      } else if (!keep.has(path.resolve(p))) fs.unlinkSync(p);
    }
  })(dirAbs);
}

fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify({ items }, null, 1));
console.log(`מאגר המורים: ${items.length} תמונות`);
