// בונה את public/data/anatomy-terms.json מקובץ "מילון מונחים.docx" (טבלאות: עברית | אנגלית)
// ומשלב אותו עם מונחי הבסיס שב-scripts/base-terms.json.
// שימוש: node scripts/build-terms.mjs ["מילון מונחים.docx"]
import JSZip from 'jszip';
import fs from 'node:fs';

const src = process.argv[2] || 'מילון מונחים.docx';
const base = JSON.parse(fs.readFileSync('scripts/base-terms.json', 'utf8'));

const MAJOR = {
  'קרדיולוגיה': 'קרדיולוגיה',
  'המטולוגיה ולימפה': 'המטולוגיה ולימפה',
  'נפרולוגיה': 'נפרולוגיה',
  'אנדוקרינולוגיה': 'אנדוקרינולוגיה',
  'גינקולוגיה': 'גינקולוגיה',
  'אנטומיה ופיזיולוגיה - מערכת הרבייה הזכרית': 'מערכת הרבייה הזכרית',
};
// תיקוני כתיב / כינויים נפוצים (נוספים לשם שבמסמך, לא במקומו)
const HE_ALIASES = {
  'נים': ['נימים', 'נימי דם'],
  'תאים אאיזונולים': ['תאים אאוזינופילים', 'אאוזינופילים'],
  'מאחרוי הצפק (רטרופריטונאלי)': ['מאחורי הצפק'],
  'היפופיזה אחרוית': ['היפופיזה אחורית'],
  'טמירות אשכים': ['אשך טמיר'],
  'אוניות': ['אונות'],
  'אוניות האשך': ['אונות האשך'],
  'מערכת הלימפתית': ['מערכת הלימפה'],
  'ליבת הכליה': ['מדולה של הכליה'],
};
// מונחים אנגליים קצרים/רב-משמעיים מקבלים הקשר לחיפוש תמונות
const EN_CONTEXT = {
  Ventricle: 'heart ventricle', Atrium: 'heart atrium', 'Right / Left Atria': 'heart atria',
  Septum: 'heart septum', Fundus: 'uterus fundus', Body: 'uterus body', Ligament: 'uterine ligament',
  Capsule: 'adrenal gland capsule', Ducts: 'breast ducts', Lobules: 'breast lobules',
  Follicle: 'ovarian follicle', Tubule: 'nephron tubule', 'Renal Pelvis': 'renal pelvis kidney',
  Antigens: 'antigen', Toxins: 'toxin', 'Pacemaker': 'cardiac pacemaker',
};

const z = await JSZip.loadAsync(fs.readFileSync(src));
const xml = (await z.file('word/document.xml').async('string')).split('<w:body>')[1];
const txt = (s) => [...s.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, ' ').trim();

const re = /<w:tr[ >][\s\S]*?<\/w:tr>|<w:p[ >][\s\S]*?<\/w:p>/g;
let group = 'כללי';
let sub = '';
const entries = [];
const issues = [];
let m;
while ((m = re.exec(xml))) {
  const s = m[0];
  if (s.startsWith('<w:tr')) {
    re.lastIndex = m.index + s.length;
    const cells = [...s.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((c) => txt(c[0]));
    if (cells.length < 2) continue;
    const [heRaw, enRaw] = cells;
    if (!heRaw) continue;
    if (!enRaw || /ללא אנגלית/.test(enRaw)) { issues.push(`ללא אנגלית: ${heRaw}`); continue; }
    entries.push({ heRaw, enRaw, group, sub });
  } else {
    const t = txt(s).replace(/^[-–\s]+/, '');
    if (!t) continue;
    if (MAJOR[t]) { group = MAJOR[t]; sub = ''; }
    else if (t !== 'אנטומיה ופיזיולוגיה') sub = t.replace(/^אנטומיה ופיזיולוגיה - /, '');
  }
}

const clean = (x) => x.replace(/\s+/g, ' ').trim();
const noParen = (x) => clean(x.replace(/\([^)]*\)|\)[^(]*\)/g, ''));
const heVariants = (raw) => {
  const out = new Set();
  const add = (v) => { v = clean(v.replace(/^[-–]\s*/, '')); if (v.length >= 2) out.add(v); };
  const parts = raw.split(/\s\/\s/);
  for (const p of parts) {
    add(noParen(p));
    const pm = p.match(/\(([^)]+)\)/);
    if (pm) { add(p.replace(/[()]/g, '')); add(pm[1].replace(/["“”]/g, '')); }
  }
  for (const a of HE_ALIASES[raw] || []) add(a);
  return [...out];
};
const enVariants = (raw) => {
  let list;
  if (/^(Right|Afferent)\b.*\//.test(raw)) list = [raw.replace(/\s\/\s/g, ' and ')];
  else list = raw.split(/,|\s\/\s/);
  const out = [];
  for (const p of list) {
    let v = clean(noParen(p));
    if (!v || /^[A-Z]{1,3}$/.test(v) && v.length < 2) continue;
    v = EN_CONTEXT[v] || v;
    if (!out.includes(v)) out.push(v);
  }
  return out;
};

const seen = new Map();
const fromDoc = [];
for (const e of entries) {
  const he = heVariants(e.heRaw);
  const en = enVariants(e.enRaw);
  if (!he.length || !en.length) { issues.push(`לא פוענח: ${e.heRaw} | ${e.enRaw}`); continue; }
  const key = he[0];
  if (seen.has(key)) {
    const prev = seen.get(key);
    for (const v of en) if (!prev.en.includes(v)) prev.en.push(v);
    continue;
  }
  const entry = { he, en, group: e.group, ...(e.sub ? { section: e.sub } : {}) };
  seen.set(key, entry);
  fromDoc.push(entry);
}

// מונחי הבסיס שלא מופיעים במילון המסמך
const norm = (s) => s.replace(/[\u0591-\u05C7"'׳״]/g, '').trim();
const docHe = new Set(fromDoc.flatMap((e) => e.he.map(norm)));
const extra = base.terms
  .map((t) => ({ ...t, he: t.he.filter((h) => !docHe.has(norm(h))) }))
  .filter((t) => t.he.length > 0);

const out = {
  _הערה: 'נוצר אוטומטית ע"י scripts/build-terms.mjs מתוך "מילון מונחים.docx" + scripts/base-terms.json. לעריכה: עדכנו את המסמך והריצו node scripts/build-terms.mjs. he = שמות בעברית, en = מונחי חיפוש באנגלית (הראשון משמש לחיפוש).',
  terms: [...fromDoc, ...extra],
  groups: [...new Set([...fromDoc.map((e) => e.group), ...extra.map((e) => e.group)])],
};
fs.writeFileSync('public/data/anatomy-terms.json', JSON.stringify(out, null, 1));
console.log(`מהמסמך: ${fromDoc.length} פריטים, מונחי בסיס שנשארו: ${extra.length}`);
if (issues.length) console.log('הערות:\n' + issues.join('\n'));
