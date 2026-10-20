import type { SearchResult } from '../types';
import { classifyLicense, safeUrl } from '../lib/license';

const API = 'https://api.openverse.org/v1/images/';
/** מקורות שאינם כפולים של Commons/Wellcome */
const SOURCES = 'nihbioart,smithsonian,europeana,met,rijksmuseum,nasa,thorvaldsen';

interface OvItem {
  id: string;
  title?: string;
  creator?: string;
  url?: string;
  thumbnail?: string;
  foreign_landing_url?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  source?: string;
  provider?: string;
  width?: number;
  height?: number;
  filetype?: string;
}

export interface OpenversePage {
  results: SearchResult[];
  next?: number;
  total?: number;
}

function licenseName(i: OvItem): string {
  const l = (i.license || '').toLowerCase();
  if (l === 'cc0') return 'CC0';
  if (l === 'pdm') return 'Public Domain Mark';
  return `CC ${l.toUpperCase()}${i.license_version ? ' ' + i.license_version : ''}`;
}

export async function searchOpenverse(query: string, page: number, signal?: AbortSignal): Promise<OpenversePage> {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    page_size: '20',
    source: SOURCES,
    license_type: 'modification',
    category: 'illustration,photograph',
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`${API}?${params}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Openverse ${res.status}`);
    const j = await res.json();
    const items: OvItem[] = j.results ?? [];
    const results: SearchResult[] = items
      .filter((i) => i.url && i.license)
      .map((i) => ({
        key: `openverse:${i.id}`,
        source: 'openverse' as const,
        sourceId: i.id,
        title: (i.title || 'ללא כותרת').slice(0, 160),
        author: (i.creator || 'יוצר לא צוין').slice(0, 200),
        description: '',
        pageUrl: safeUrl(i.foreign_landing_url) ?? '',
        // התמונה הממוזערת מ-Openverse נגישה גם לתצוגה וגם לייצוא (CORS)
        thumbUrl: `${API}${i.id}/thumb/`,
        fullUrl: safeUrl(i.url) ?? '',
        width: i.width,
        height: i.height,
        mime: i.filetype ? `image/${i.filetype}` : undefined,
        license: classifyLicense(licenseName(i), safeUrl(i.license_url)),
        credit: `${i.source || i.provider || 'Openverse'} via Openverse`,
      }));
    const pages: number = j.page_count ?? 1;
    return { results, next: page < pages ? page + 1 : undefined, total: j.result_count };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
