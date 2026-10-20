// בונה את public/library/index.json מכל קבצי התמונה שבתיקייה public/library (כולל תיקיות משנה).
// שם הקובץ (ושם התיקייה) הם מילות החיפוש: kidney_nephron.png  ->  kidney, nephron
// פרטי קרדיט (אופציונלי) מתוך public/library/credits.csv: file,author,license,source
import fs from 'node:fs';
import path from 'node:path';

const root = 'public/library';
const EXT = /\.(png|jpe?g|webp|gif)$/i;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
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

const items = fs.existsSync(root)
  ? walk(root).sort().map((p) => {
      const rel = path.relative(root, p).split(path.sep).join('/');
      const c = credits.get(rel) || credits.get(path.basename(rel)) || {};
      const folders = rel.split('/').slice(0, -1);
      return {
        file: rel,
        title: pretty(path.basename(rel)),
        keywords: [...new Set(tokens(folders.join(' ') + ' ' + path.basename(rel).replace(EXT, '')))],
        ...(c.author ? { author: c.author } : {}),
        ...(c.license ? { license: c.license } : {}),
        ...(c.source ? { source: c.source } : {}),
      };
    })
  : [];

fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify({ items }, null, 1));
console.log(`מאגר המורים: ${items.length} תמונות`);
