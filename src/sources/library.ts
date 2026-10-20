import type { SearchResult } from '../types';
import { classifyLicense } from '../lib/license';
import { expandQuery, hasHebrew, type TermsFile } from '../lib/terms';

/** פריט באינדקס של מאגר המורים (נוצר ע"י scripts/build-library.mjs) */
export interface LibraryItem {
  file: string;
  /** גרסת אתר (WebP) וממוזערת, נוצרות אוטומטית בבנייה */
  web?: string;
  thumb?: string;
  w?: number;
  h?: number;
  title: string;
  keywords: string[];
  author?: string;
  license?: string;
  source?: string;
}

let cache: Promise<LibraryItem[]> | null = null;

export function loadLibrary(): Promise<LibraryItem[]> {
  if (!cache) {
    cache = fetch(`${import.meta.env.BASE_URL}library/index.json`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((j) => (Array.isArray(j.items) ? (j.items as LibraryItem[]) : []))
      .catch(() => []);
  }
  return cache;
}

// מילים כלליות מדי: לא מחשיבים אותן כהתאמה (אחרת 'reproductive' יביא תמונות נשיות גם לנושא הזכרי)
const STOP = new Set(['anatomy', 'human', 'diagram', 'illustration', 'structure', 'system', 'the', 'and', 'of', 'reproductive', 'gland', 'glands', 'cell', 'cells', 'tissue', 'body']);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t) && !STOP.has(t));
}

/** רדוקציה גסה לריבוי באנגלית: kidneys -> kidney */
export const stem = (raw: string): string => {
  const t = raw.toLowerCase();
  if (hasHebrew(t)) {
    // הלב ~ לב; שחלות / שחלה ~ שחל; כליות ~ כליה
    let h = t.length > 3 && t.startsWith('ה') ? t.slice(1) : t;
    if (h.length > 3 && (h.endsWith('ות') || h.endsWith('ים'))) h = h.slice(0, -2);
    else if (h.length > 3 && h.endsWith('ה')) h = h.slice(0, -1);
    return h;
  }
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y'; // ovaries -> ovary
  if (t.length > 4 && /(ss|x|z|ch|sh)es$/.test(t)) return t.slice(0, -2);
  return t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t;
};

/** קבצים בשם עברי: מוסיפים להם גם מילות מפתח באנגלית לפי מילון המונחים */
export function withEnglishKeywords(item: LibraryItem, terms: TermsFile | null): LibraryItem {
  if (!terms || !item.keywords.some(hasHebrew)) return item;
  const extra = new Set<string>();
  const phrases = [item.keywords.join(' '), ...item.keywords.filter(hasHebrew)];
  for (const p of phrases) for (const en of expandQuery(p, terms).english) for (const t of tokenize(en)) extra.add(t);
  return extra.size ? { ...item, keywords: [...item.keywords, ...extra] } : item;
}

/**
 * התאמה בין מילות חיפוש לפריט: כל מילה שמופיעה במילות המפתח (או כתחילית שלהן) מוסיפה ניקוד.
 * מחזיר 0 אם אין התאמה.
 */
export function scoreItem(item: LibraryItem, queryTokens: string[]): number {
  const kw = item.keywords.map(stem);
  let score = 0;
  for (const q of new Set(queryTokens.map(stem))) {
    if (kw.some((k) => k === q || (q.length >= 4 && k.startsWith(q)) || (k.length >= 4 && q.startsWith(k)))) score++;
  }
  return score;
}

export function toResult(item: LibraryItem): SearchResult {
  const href = (rel: string) => `${import.meta.env.BASE_URL}library/${rel.split('/').map(encodeURIComponent).join('/')}`;
  const url = href(item.web ?? item.file);
  const thumb = href(item.thumb ?? item.web ?? item.file);
  const license = item.license
    ? classifyLicense(item.license)
    : {
        name: 'מאגר המורים',
        level: 'user' as const,
        note: 'הועלתה על ידי צוות הכלי. האחריות לזכויות השימוש על המעלה; אין פרטי רישיון.',
      };
  return {
    key: `library:${item.file}`,
    source: 'library',
    sourceId: item.file,
    title: item.title,
    author: item.author || 'מאגר המורים',
    description: '',
    pageUrl: item.source && /^https?:\/\//.test(item.source) ? item.source : '',
    thumbUrl: thumb,
    fullUrl: url,
    width: item.w,
    height: item.h,
    license,
    credit: item.source && !/^https?:\/\//.test(item.source) ? item.source : 'מאגר המורים',
  };
}

/** חיפוש במאגר המורים לפי רשימת ביטויים (אנגלית + עברית); בלי ביטויים — כל המאגר */
export async function searchLibrary(phrases: string[], terms: TermsFile | null = null): Promise<SearchResult[]> {
  const items = (await loadLibrary()).map((it) => withEnglishKeywords(it, terms));
  const tokens = phrases.flatMap(tokenize);
  if (!tokens.length) return items.map(toResult);
  return items
    .map((it) => ({ it, s: scoreItem(it, tokens) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => toResult(x.it));
}
