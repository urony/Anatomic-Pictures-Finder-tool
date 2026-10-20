export interface TermEntry {
  he: string[];
  en: string[];
  group: string;
}

export interface TermsFile {
  terms: TermEntry[];
  groups: string[];
}

/** מסיר ניקוד, גרשיים ומעט סימנים כדי להשוות עברית בצורה סלחנית */
export function normalizeHebrew(s: string): string {
  return s
    .replace(/[֑-ׇ]/g, '')
    .replace(/[׳״"'׳״`]/g, '')
    .replace(/[-–—_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const PREFIXES = ['וה', 'וב', 'ול', 'ומ', 'ה', 'ב', 'ל', 'מ'];

/** וריאציות של מילה: עם ובלי תחילית (ה/ב/ל...) */
function variants(word: string): string[] {
  const out = new Set<string>([word]);
  for (const p of PREFIXES) {
    if (word.startsWith(p) && word.length - p.length >= (p === 'ה' ? 2 : 3)) out.add(word.slice(p.length));
  }
  return [...out];
}

export function hasHebrew(s: string): boolean {
  return /[֐-׿]/.test(s);
}

export interface Expansion {
  /** מונחי חיפוש באנגלית, לפי סדר רלוונטיות */
  english: string[];
  /** האם נמצאה התאמה במילון */
  matched: boolean;
  /** אם הטקסט כבר באנגלית — מעבירים כמו שהוא */
  passthrough: boolean;
}

/** מרחיב שאילתה בעברית למונחים באנגלית לפי המילון המקומי */
export function expandQuery(query: string, file: TermsFile | null): Expansion {
  const q = query.trim();
  if (!q) return { english: [], matched: false, passthrough: false };
  if (!hasHebrew(q)) return { english: [q], matched: false, passthrough: true };
  if (!file) return { english: [], matched: false, passthrough: false };

  const nq = normalizeHebrew(q);
  const qWords = nq.split(' ').flatMap(variants);
  const scored: { entry: TermEntry; score: number }[] = [];

  for (const entry of file.terms) {
    let best = 0;
    for (const he of entry.he) {
      const nh = normalizeHebrew(he);
      if (!nh) continue;
      if (nh === nq) best = Math.max(best, 100);
      else if (variants(nh).some((v) => v === nq) || variants(nq).some((v) => v === nh)) best = Math.max(best, 90);
      else {
        // כל מילות ביטוי המילון קיימות בשאילתה (או להפך)
        const hWords = nh.split(' ').flatMap(variants);
        const allInQuery = nh.split(' ').every((w) => variants(w).some((v) => qWords.includes(v)));
        const allInTerm = nq.split(' ').every((w) => variants(w).some((v) => hWords.includes(v)));
        if (allInQuery) best = Math.max(best, 60 + nh.length);
        else if (allInTerm) best = Math.max(best, 40 + nq.length);
      }
    }
    if (best > 0) scored.push({ entry, score: best });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]?.score ?? 0;
  const floor = top >= 90 ? 90 : 0;
  const english: string[] = [];
  const seen = new Set<string>();
  for (const { entry, score } of scored.slice(0, 3)) {
    if (score < floor) continue;
    for (const en of entry.en) {
      if (!seen.has(en)) {
        seen.add(en);
        english.push(en);
      }
    }
  }
  return { english: english.slice(0, 4), matched: english.length > 0, passthrough: false };
}

/** הצעות השלמה לפי תחילת מילה */
export function suggest(query: string, file: TermsFile | null, limit = 8): string[] {
  if (!file) return [];
  const nq = normalizeHebrew(query);
  if (nq.length < 1) return [];
  const out: string[] = [];
  for (const entry of file.terms) {
    for (const he of entry.he) {
      if (normalizeHebrew(he).startsWith(nq) && !out.includes(he)) out.push(he);
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}
