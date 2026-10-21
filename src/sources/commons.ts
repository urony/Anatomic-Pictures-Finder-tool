import type { SearchResult } from '../types';
import { classifyLicense, safeUrl, stripHtml } from '../lib/license';

const API = 'https://commons.wikimedia.org/w/api.php';
const META_FILTER =
  'LicenseShortName|LicenseUrl|Artist|Credit|ImageDescription|ObjectName|UsageTerms|Restrictions|NonFree';

/**
 * Wikimedia מגביל קצב בקשות; כשחורגים הוא עונה 429 בלי כותרות CORS, וזה נראה בדפדפן כמו כשל רשת.
 * לכן כל הבקשות עוברות דרך תור עם מספר מוגבל של בקשות במקביל, ועם ניסיון חוזר קצר.
 */
const MAX_PARALLEL = 2;
const MIN_GAP_MS = 120; // מרווח מינימלי בין תחילת בקשות
let lastStart = 0;
let active = 0;
const waiting: (() => void)[] = [];

function throttled<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      if (signal?.aborted) {
        reject(new DOMException('aborted', 'AbortError'));
        waiting.shift()?.();
        return;
      }
      active++;
      const wait = Math.max(0, lastStart + MIN_GAP_MS - Date.now());
      lastStart = Date.now() + wait;
      new Promise<void>((go) => setTimeout(go, wait))
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          active--;
          waiting.shift()?.();
        });
    };
    if (active < MAX_PARALLEL) run();
    else waiting.push(run);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let blockedUntil = 0; // אחרי כשל חוזר לא מציפים את השרת: כל בקשה נכשלת מיד למשך כמה שניות

/** fetch עם ניסיון חוזר (עד 2 פעמים) על כשל רשת או 429/5xx */
async function politeFetch(url: string, signal?: AbortSignal): Promise<Response> {
  if (Date.now() < blockedUntil) throw new Error('Commons temporarily limited');
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    try {
      const res = await throttled(() => fetch(url, { signal }), signal);
      if (res.ok || (res.status !== 429 && res.status < 500)) return res;
      lastErr = new Error(`Commons ${res.status}`);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      lastErr = e;
    }
    await sleep(600 * (attempt + 1));
  }
  blockedUntil = Date.now() + 20000;
  throw lastErr instanceof Error ? lastErr : new Error('Commons');
}

export interface CommonsPage {
  results: SearchResult[];
  next?: number;
  total?: number;
}

interface ImageInfo {
  url: string;
  thumburl?: string;
  width: number;
  height: number;
  mime: string;
  descriptionurl: string;
  extmetadata?: Record<string, { value?: string }>;
}

function metaOf(info: ImageInfo, key: string): string {
  return stripHtml(info.extmetadata?.[key]?.value);
}

function toResult(title: string, info: ImageInfo): SearchResult {
  const licName = metaOf(info, 'LicenseShortName') || metaOf(info, 'UsageTerms');
  const nonFree = metaOf(info, 'NonFree');
  let license = classifyLicense(licName, safeUrl(metaOf(info, 'LicenseUrl')));
  if (nonFree && nonFree.toLowerCase() === 'true') {
    license = { ...license, level: 'unclear', note: 'הקובץ מסומן כלא-חופשי. לא מומלץ להשתמש.' };
  }
  const author = metaOf(info, 'Artist') || metaOf(info, 'Credit') || 'יוצר לא צוין';
  const niceTitle = (metaOf(info, 'ObjectName') || title.replace(/^File:/, '').replace(/\.[^.]+$/, '')).slice(0, 160);
  return {
    key: `commons:${title}`,
    source: 'commons',
    sourceId: title,
    title: niceTitle,
    author: author.slice(0, 200),
    description: metaOf(info, 'ImageDescription').slice(0, 300),
    pageUrl: info.descriptionurl,
    thumbUrl: info.thumburl || info.url,
    fullUrl: info.url,
    width: info.width,
    height: info.height,
    mime: info.mime,
    license,
    credit: 'Wikimedia Commons',
  };
}

const pageCache = new Map<string, CommonsPage>();

/** מטמון תוצאות בזיכרון: אותו חיפוש חוזר (למשל לחיצה חוזרת על אותו נושא) לא פונה שוב לשרת */
export function searchCommons(query: string, kind: 'any' | 'drawing' | 'bitmap', offset: number, signal?: AbortSignal, limit = 24): Promise<CommonsPage> {
  const key = `${query}|${kind}|${offset}|${limit}`;
  const hit = pageCache.get(key);
  if (hit) return Promise.resolve(hit);
  return searchCommonsUncached(query, kind, offset, signal, limit).then((p) => {
    if (pageCache.size > 300) pageCache.clear();
    pageCache.set(key, p);
    return p;
  });
}

async function searchCommonsUncached(
  query: string,
  kind: 'any' | 'drawing' | 'bitmap',
  offset: number,
  signal?: AbortSignal,
  limit = 24,
): Promise<CommonsPage> {
  const filetype = kind === 'drawing' ? 'filetype:drawing' : kind === 'bitmap' ? 'filetype:bitmap' : 'filetype:bitmap|drawing';
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `${query} ${filetype}`,
    gsrlimit: String(limit),
    gsroffset: String(offset),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '500',
    iiextmetadatafilter: META_FILTER,
  });
  const res = await politeFetch(`${API}?${params}`, signal);
  if (!res.ok) throw new Error(`Commons ${res.status}`);
  const j = await res.json();
  const pages: Array<{ title: string; index?: number; imageinfo?: ImageInfo[] }> = Object.values(j.query?.pages ?? {});
  pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const results = pages
    .filter((p) => p.imageinfo?.[0] && /^image\/(jpeg|png|svg\+xml|gif|webp)$/.test(p.imageinfo[0].mime))
    .map((p) => toResult(p.title, p.imageinfo![0]));
  return {
    results,
    next: j.continue?.gsroffset,
    total: j.searchinfo?.totalhits,
  };
}

/**
 * מחזיר כתובת של גרסה מוקטנת/מומרת (עד 1920 פיקסלים) שבטוח לטעון לתוך Canvas.
 * עבור SVG ופורמטים לא נתמכים מתקבלת גרסת PNG/JPEG מרונדרת של Commons.
 */
export async function resolveCommonsExportUrl(r: SearchResult, signal?: AbortSignal): Promise<{ url: string; width: number; height: number }> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    titles: r.sourceId,
    prop: 'imageinfo',
    iiprop: 'url|size|mime',
    iiurlwidth: '1920',
  });
  const res = await politeFetch(`${API}?${params}`, signal);
  if (!res.ok) throw new Error(`Commons ${res.status}`);
  const j = await res.json();
  const page = Object.values(j.query?.pages ?? {})[0] as { imageinfo?: ImageInfo[] } | undefined;
  const info = page?.imageinfo?.[0];
  if (!info) throw new Error('לא נמצא מידע על הקובץ');
  const isSvg = info.mime === 'image/svg+xml';
  if (!isSvg && info.width <= 1920 && /^image\/(jpeg|png|webp)$/.test(info.mime)) {
    return { url: info.url, width: info.width, height: info.height };
  }
  const url = info.thumburl || info.url;
  const scale = info.width > 1920 || isSvg ? 1920 / info.width : 1;
  return {
    url,
    width: Math.round(info.width * Math.min(scale, isSvg ? scale : 1)),
    height: Math.round(info.height * Math.min(scale, isSvg ? scale : 1)),
  };
}

/* ------------------------------------------------------------------ */
/* חיפוש רב-אסטרטגיות: קטגוריות איורי אנטומיה, NIH BioArt והיסטולוגיה  */
/* ------------------------------------------------------------------ */

export type KindFilter = 'all' | 'illustration' | 'photo' | 'imaging' | 'micro';

interface Strategy {
  key: string;
  query: (term: string) => string;
  type: 'any' | 'drawing' | 'bitmap';
}

const S_ILLUS: Strategy = { key: 'illus', query: (t) => `${t} deepcategory:"Anatomical illustrations"`, type: 'any' };
const S_DIAGRAM: Strategy = { key: 'diagram', query: (t) => `${t} deepcategory:"Anatomy diagrams"`, type: 'any' };
const S_NIH: Strategy = { key: 'nih', query: (t) => `${t} "NIH BioArt"`, type: 'any' };
const S_HISTO: Strategy = { key: 'histo', query: (t) => `${t} deepcategory:"Histology"`, type: 'bitmap' };

export function commonsStrategies(kind: KindFilter): Strategy[] {
  switch (kind) {
    case 'illustration':
      return [S_ILLUS, S_DIAGRAM, S_NIH];
    case 'micro':
      return [S_HISTO, { key: 'micro', query: (t) => `${t} histology`, type: 'bitmap' }];
    case 'photo':
      return [{ key: 'photo', query: (t) => `${t} photograph`, type: 'bitmap' }];
    case 'imaging':
      return [{ key: 'imaging', query: (t) => `${t} CT`, type: 'bitmap' }, { key: 'xray', query: (t) => `${t} radiograph`, type: 'bitmap' }];
    default:
      return [S_ILLUS, S_DIAGRAM, S_NIH, { key: 'general', query: (t) => `${t} anatomy`, type: 'any' }, S_HISTO];
  }
}

/** מנקה מונחי בסיס כמו "heart anatomy" לשם הנקי "heart" לשימוש בקטגוריות */
export function plainTerm(term: string): string {
  return term.replace(/\b(anatomy|structure)\b/gi, '').replace(/\s+/g, ' ').trim() || term;
}

export interface MultiCursor {
  /** offset הבא לכל אסטרטגיה; חסר = אין עוד */
  next: Record<string, number | undefined>;
  total: number;
}

/** עמוד תוצאות מכל האסטרטגיות במקביל, משולב לסירוגין וללא כפילויות */
export async function searchCommonsMulti(
  term: string,
  kind: KindFilter,
  cursor: MultiCursor | null,
  signal?: AbortSignal,
  perStrategy = 12,
  only?: string[],
): Promise<{ results: SearchResult[]; cursor: MultiCursor }> {
  const strategies = commonsStrategies(kind).filter((st) => (!cursor || cursor.next[st.key] !== undefined) && (!only || only.includes(st.key)));
  const t = plainTerm(term);
  const settled = await Promise.allSettled(
    strategies.map((st) => searchCommons(st.query(t), st.type, cursor?.next[st.key] ?? 0, signal, perStrategy)),
  );
  if (settled.every((r) => r.status === 'rejected')) throw new Error('Commons');
  const next: Record<string, number | undefined> = {};
  let total = 0;
  const lists: SearchResult[][] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      lists.push(r.value.results);
      next[strategies[i].key] = r.value.next;
      total += r.value.total ?? 0;
    } else {
      next[strategies[i].key] = undefined;
    }
  });
  // לפי סדר האסטרטגיות (איורי אנטומיה קודם), ללא כפילויות
  const merged: SearchResult[] = [];
  const seen = new Set<string>();
  for (const l of lists) {
    for (const x of l) {
      if (!seen.has(x.key)) {
        seen.add(x.key);
        merged.push(x);
      }
    }
  }
  return { results: merged, cursor: { next, total } };
}
