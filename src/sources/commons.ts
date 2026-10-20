import type { SearchResult } from '../types';
import { classifyLicense, safeUrl, stripHtml } from '../lib/license';

const API = 'https://commons.wikimedia.org/w/api.php';
const META_FILTER =
  'LicenseShortName|LicenseUrl|Artist|Credit|ImageDescription|ObjectName|UsageTerms|Restrictions|NonFree';

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

export async function searchCommons(
  query: string,
  kind: 'any' | 'drawing' | 'bitmap',
  offset: number,
  signal?: AbortSignal,
): Promise<CommonsPage> {
  const filetype = kind === 'drawing' ? 'filetype:drawing' : kind === 'bitmap' ? 'filetype:bitmap' : 'filetype:bitmap|drawing';
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: `${query} ${filetype}`,
    gsrlimit: '24',
    gsroffset: String(offset),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '500',
    iiextmetadatafilter: META_FILTER,
  });
  const res = await fetch(`${API}?${params}`, { signal });
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
  const res = await fetch(`${API}?${params}`, { signal });
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
