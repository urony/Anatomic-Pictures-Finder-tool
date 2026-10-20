import type { SearchResult } from '../types';
import { classifyLicense, safeUrl } from '../lib/license';

const API = 'https://api.wellcomecollection.org/catalogue/v2/images';

interface WLocation {
  url: string;
  credit?: string;
  license?: { id: string; label: string; url?: string };
}
interface WImage {
  id: string;
  aspectRatio?: number;
  thumbnail?: WLocation;
  locations?: WLocation[];
  source?: { id: string; title?: string };
}

export interface WellcomePage {
  results: SearchResult[];
  next?: number;
  total?: number;
}

/** IIIF: .../image/V0007778EC/info.json -> .../image/V0007778EC */
function iiifBase(infoUrl: string): string {
  return infoUrl.replace(/\/info\.json$/, '');
}

export function wellcomeImageUrl(base: string, width: number): string {
  return `${base}/full/${width},/0/default.jpg`;
}

export async function searchWellcome(
  query: string,
  page: number,
  onlyClearLicenses: boolean,
  signal?: AbortSignal,
): Promise<WellcomePage> {
  const params = new URLSearchParams({ query, pageSize: '24', page: String(page) });
  if (onlyClearLicenses) params.set('locations.license', 'cc-by,cc0,pdm,cc-by-sa');
  const res = await fetch(`${API}?${params}`, { signal });
  if (!res.ok) throw new Error(`Wellcome ${res.status}`);
  const j = await res.json();
  const items: WImage[] = j.results ?? [];
  const results: SearchResult[] = [];
  for (const it of items) {
    const loc = it.locations?.find((l) => l.url?.includes('iiif')) ?? it.thumbnail;
    if (!loc?.url) continue;
    const base = iiifBase(loc.url);
    const lic = classifyLicense(loc.license?.label ?? loc.license?.id, safeUrl(loc.license?.url));
    const ar = it.aspectRatio && it.aspectRatio > 0 ? it.aspectRatio : undefined;
    results.push({
      key: `wellcome:${it.id}`,
      source: 'wellcome',
      sourceId: it.id,
      title: (it.source?.title || 'ללא כותרת').slice(0, 160),
      author: 'ראו דף המקור',
      description: '',
      pageUrl: it.source?.id
        ? `https://wellcomecollection.org/works/${it.source.id}/images?id=${it.id}`
        : 'https://wellcomecollection.org/',
      thumbUrl: wellcomeImageUrl(base, 400),
      fullUrl: wellcomeImageUrl(base, 1600),
      width: ar ? 1600 : undefined,
      height: ar ? Math.round(1600 / ar) : undefined,
      mime: 'image/jpeg',
      license: lic,
      credit: loc.credit || 'Wellcome Collection',
    });
  }
  const totalPages: number = j.totalPages ?? 1;
  return { results, next: page < totalPages ? page + 1 : undefined, total: j.totalResults };
}
