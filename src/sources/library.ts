import type { SearchResult } from '../types';
import { classifyLicense } from '../lib/license';

/** פריט באינדקס של מאגר המורים (נוצר ע"י scripts/build-library.mjs) */
export interface LibraryItem {
  file: string;
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

const STOP = new Set(['anatomy', 'human', 'diagram', 'illustration', 'structure', 'system', 'the', 'and', 'of']);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t) && !STOP.has(t));
}

/** רדוקציה גסה לריבוי באנגלית: kidneys -> kidney */
const stem = (t: string) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);

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
  const url = `${import.meta.env.BASE_URL}library/${item.file.split('/').map(encodeURIComponent).join('/')}`;
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
    thumbUrl: url,
    fullUrl: url,
    license,
    credit: item.source && !/^https?:\/\//.test(item.source) ? item.source : 'מאגר המורים',
  };
}

/** חיפוש במאגר המורים לפי רשימת ביטויים (אנגלית + עברית); בלי ביטויים — כל המאגר */
export async function searchLibrary(phrases: string[]): Promise<SearchResult[]> {
  const items = await loadLibrary();
  const tokens = phrases.flatMap(tokenize);
  if (!tokens.length) return items.map(toResult);
  return items
    .map((it) => ({ it, s: scoreItem(it, tokens) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => toResult(x.it));
}
