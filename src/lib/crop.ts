import type { Cover, ExamImage, Mark } from '../types';
import { loadHtmlImage } from './imageLoad';

/** מלבן יחסי (0..1) */
export interface Rect01 {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL: Rect01 = { x: 0, y: 0, w: 1, h: 1 };

/** המלבן הנוכחי של התמונה ביחס למקור שממנו נחתכה (או כל התמונה אם לא נחתכה) */
export function currentRect(image: ExamImage): Rect01 {
  const c = image.crop;
  return c ? { x: c.x, y: c.y, w: c.w, h: c.h } : FULL;
}

/** המקור שממנו חותכים: התמונה המקורית אם כבר נחתכה, אחרת התמונה עצמה */
export function cropSource(image: ExamImage): { dataUrl: string; width: number; height: number } {
  return image.crop
    ? { dataUrl: image.crop.src, width: image.crop.srcW, height: image.crop.srcH }
    : { dataUrl: image.dataUrl, width: image.width, height: image.height };
}

const EPS = 0.002;

export interface Remapped {
  marks: Mark[];
  covers: Cover[];
  droppedMarks: number;
  droppedCovers: number;
}

/**
 * מעביר סימונים והסתרות ממערכת הקואורדינטות של התמונה הנוכחית למערכת של החיתוך החדש.
 * מספר שהתווית או היעד שלו נופלים מחוץ לחיתוך — נמחק; הסתרה נחתכת לגבולות החיתוך.
 */
export function remapAnnotations(image: ExamImage, next: Rect01): Remapped {
  const r0 = currentRect(image);
  const px = (v: number) => (r0.x + v * r0.w - next.x) / next.w;
  const py = (v: number) => (r0.y + v * r0.h - next.y) / next.h;
  const inside = (v: number) => v >= -EPS && v <= 1 + EPS;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));

  const marks: Mark[] = [];
  let droppedMarks = 0;
  for (const m of image.marks) {
    const lx = px(m.lx);
    const ly = py(m.ly);
    const tx = px(m.tx);
    const ty = py(m.ty);
    if (inside(lx) && inside(ly) && inside(tx) && inside(ty)) {
      marks.push({ ...m, lx: clamp(lx), ly: clamp(ly), tx: clamp(tx), ty: clamp(ty) });
    } else droppedMarks++;
  }

  const covers: Cover[] = [];
  let droppedCovers = 0;
  for (const c of image.covers ?? []) {
    const x0 = Math.max(0, px(c.x));
    const y0 = Math.max(0, py(c.y));
    const x1 = Math.min(1, px(c.x + c.w));
    const y1 = Math.min(1, py(c.y + c.h));
    if (x1 - x0 > EPS && y1 - y0 > EPS) covers.push({ ...c, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    else droppedCovers++;
  }
  return { marks, covers, droppedMarks, droppedCovers };
}

/**
 * מחזיר תמונה חתוכה (או שחזור המקור כש-rect הוא null).
 * החיתוך הוא אמיתי: ה-dataUrl מוחלף בתמונה קטנה, ולכן כל השאר (עימוד, טבלה, ייצוא) עובד בלי שינוי.
 */
export async function applyCrop(image: ExamImage, rect: Rect01 | null): Promise<ExamImage> {
  const src = cropSource(image);
  const next = rect ?? FULL;
  const remapped = remapAnnotations(image, next);
  if (!rect) {
    const { crop: _crop, ...rest } = image;
    void _crop;
    return { ...rest, dataUrl: src.dataUrl, width: src.width, height: src.height, marks: remapped.marks, covers: remapped.covers };
  }
  const el = await loadHtmlImage(src.dataUrl);
  const sx = Math.max(0, Math.round(rect.x * el.naturalWidth));
  const sy = Math.max(0, Math.round(rect.y * el.naturalHeight));
  const sw = Math.max(1, Math.min(el.naturalWidth - sx, Math.round(rect.w * el.naturalWidth)));
  const sh = Math.max(1, Math.min(el.naturalHeight - sy, Math.round(rect.h * el.naturalHeight)));
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(el, sx, sy, sw, sh, 0, 0, sw, sh);
  const lossy = /^data:image\/(jpeg|webp)/.test(src.dataUrl);
  const dataUrl = lossy ? c.toDataURL('image/jpeg', 0.95) : c.toDataURL('image/png');
  return {
    ...image,
    dataUrl,
    width: sw,
    height: sh,
    marks: remapped.marks,
    covers: remapped.covers,
    crop: { src: src.dataUrl, srcW: src.width, srcH: src.height, ...rect },
  };
}
