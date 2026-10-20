import type { ExamImage, SearchResult } from '../types';
import { resolveCommonsExportUrl } from '../sources/commons';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const SUPPORTED = /^image\/(jpeg|png|webp|gif)$/;

export class ImageLoadError extends Error {}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new ImageLoadError('קריאת הקובץ נכשלה'));
    fr.readAsDataURL(blob);
  });
}

export function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImageLoadError('הדפדפן לא הצליח לפענח את התמונה'));
    img.src = src;
  });
}

async function fetchBlob(url: string, signal?: AbortSignal, timeoutMs = 45000): Promise<Blob> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new ImageLoadError(`המקור החזיר שגיאה (${res.status})`);
    return await res.blob();
  } catch (e) {
    if (e instanceof ImageLoadError) throw e;
    if ((e as Error).name === 'AbortError') throw new ImageLoadError('הטעינה ארכה יותר מדי זמן');
    throw new ImageLoadError('לא הצלחנו לטעון תמונה זו לייצוא; נסו תמונה אחרת');
  } finally {
    clearTimeout(t);
    signal?.removeEventListener('abort', onAbort);
  }
}

let counter = 0;
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * בודק שאפשר באמת להוריד את קובץ התמונה ולהשתמש בו בייצוא (לא רק להציג אותו),
 * ומחזיר אובייקט תמונה מוכן למבחן.
 */
export async function importSearchResult(r: SearchResult, signal?: AbortSignal): Promise<ExamImage> {
  const notes: string[] = [];
  let url = r.fullUrl;
  if (r.source === 'commons') {
    try {
      url = (await resolveCommonsExportUrl(r, signal)).url;
    } catch {
      url = r.thumbUrl; // גיבוי: הגרסה הממוזערת
      notes.push('נטענה גרסה קטנה של התמונה');
    }
  }
  let blob: Blob;
  if (r.source === 'wellcome') {
    // שרת IIIF לא תמיד מאפשר הגדלה מעבר לגודל המקור — מנסים גדלים יורדים
    const sizes = ['1600,', '1000,', '600,'];
    let last: unknown;
    blob = new Blob();
    let ok = false;
    for (const s of sizes) {
      try {
        url = r.fullUrl.replace(/\/full\/[^/]+\//, `/full/${s}/`);
        blob = await fetchBlob(url, signal);
        ok = true;
        break;
      } catch (e) {
        last = e;
      }
    }
    if (!ok) throw last;
  } else {
    blob = await fetchBlob(url, signal);
  }
  if (!SUPPORTED.test(blob.type)) {
    throw new ImageLoadError(`פורמט התמונה (${blob.type || 'לא ידוע'}) אינו נתמך בייצוא`);
  }
  const dataUrl = await blobToDataUrl(blob);
  const img = await loadHtmlImage(dataUrl);
  if (!img.naturalWidth || !img.naturalHeight) throw new ImageLoadError('התמונה ריקה או פגומה');
  if (r.source === 'commons' && /\.svg$/i.test(r.sourceId)) notes.push('איור וקטורי (SVG) הומר לתמונה');
  if (r.license.level !== 'free' && r.license.level !== 'share') notes.push(r.license.note);

  return {
    id: uid('img'),
    source: r.source,
    sourceId: r.sourceId,
    title: r.title,
    author: r.author,
    pageUrl: r.pageUrl,
    fileUrl: url,
    license: r.license,
    credit: r.credit,
    fetchedAt: new Date().toISOString(),
    notes,
    dataUrl,
    width: img.naturalWidth,
    height: img.naturalHeight,
    marks: [],
  };
}

export async function importLocalFile(file: File): Promise<ExamImage> {
  if (file.size > MAX_UPLOAD_BYTES) throw new ImageLoadError('הקובץ גדול מדי (מעל 25MB)');
  let blob: Blob = file;
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    blob = await rasterizeSvg(file);
  } else if (!SUPPORTED.test(file.type)) {
    throw new ImageLoadError('אפשר להעלות רק JPEG, PNG, WebP, GIF או SVG');
  }
  const dataUrl = await blobToDataUrl(blob);
  const img = await loadHtmlImage(dataUrl);
  return {
    id: uid('img'),
    source: 'upload',
    sourceId: file.name,
    title: file.name.replace(/\.[^.]+$/, ''),
    author: '',
    pageUrl: '',
    fileUrl: '',
    license: {
      name: 'הועלתה על ידי המורה',
      level: 'user',
      note: 'המשתמש אחראי לזכויות השימוש בתמונה. הכלי לא בדק את הרישיון.',
    },
    credit: 'הועלתה ידנית',
    fetchedAt: new Date().toISOString(),
    notes: ['המשתמש אחראי לזכויות השימוש בתמונה'],
    dataUrl,
    width: img.naturalWidth,
    height: img.naturalHeight,
    marks: [],
  };
}

/** SVG מקומי -> PNG (מרונדר ב-Canvas), כדי שיהיה בטוח ויציב בייצוא */
async function rasterizeSvg(file: File): Promise<Blob> {
  const text = await file.text();
  // לא מריצים סקריפטים: טוענים כתמונה בלבד (בתגית img SVG אינו מריץ סקריפטים)
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = await loadHtmlImage(url);
    const w = img.naturalWidth || 1200;
    const h = img.naturalHeight || 900;
    const scale = Math.min(2400 / Math.max(w, h), 4);
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new ImageLoadError('המרת SVG נכשלה'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
