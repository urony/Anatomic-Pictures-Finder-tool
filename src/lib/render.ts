import type { ExamImage, Mark, MarkSize } from '../types';
import { FONT, HEADER_FONT, MARK_RADIUS, MARGIN, type PageLayout, type Rect } from './layout';
import { loadHtmlImage } from './imageLoad';

/* ------------------------------------------------------------------ */
/* מטמון תמונות                                                         */
/* ------------------------------------------------------------------ */

const imgCache = new Map<string, Promise<HTMLImageElement>>();

export function getImageElement(img: ExamImage): Promise<HTMLImageElement> {
  let p = imgCache.get(img.id);
  if (!p) {
    p = loadHtmlImage(img.dataUrl);
    imgCache.set(img.id, p);
    p.catch(() => imgCache.delete(img.id));
  }
  return p;
}

export async function loadElements(images: ExamImage[]): Promise<Map<string, HTMLImageElement>> {
  const map = new Map<string, HTMLImageElement>();
  await Promise.all(images.map(async (im) => map.set(im.id, await getImageElement(im))));
  return map;
}

/* ------------------------------------------------------------------ */
/* ציור סימונים (משותף לעורך ולעמוד המודפס)                            */
/* ------------------------------------------------------------------ */

export interface MarkStyle {
  radius: number;
  highlightId?: string | null;
}

export function drawMarks(ctx: CanvasRenderingContext2D, marks: Mark[], rect: Rect, style: MarkStyle): void {
  const r = style.radius;
  ctx.save();
  ctx.direction = 'ltr';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const m of marks) {
    const lx = rect.x + m.lx * rect.w;
    const ly = rect.y + m.ly * rect.h;
    const tx = rect.x + m.tx * rect.w;
    const ty = rect.y + m.ty * rect.h;
    if (m.line) {
      const dx = tx - lx;
      const dy = ty - ly;
      const len = Math.hypot(dx, dy);
      if (len > r + 2) {
        const ux = dx / len;
        const uy = dy / len;
        const sx = lx + ux * r;
        const sy = ly + uy * r;
        const head = Math.max(5, r * 0.75);
        const bx = tx - ux * head;
        const by = ty - uy * head;
        // הילה לבנה לקריאות על רקע כהה
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = r * 0.34 + 2.2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.strokeStyle = '#111';
        ctx.lineWidth = r * 0.16 + 0.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(bx, by);
        ctx.stroke();
        // ראש חץ
        const px = -uy;
        const py = ux;
        const w = head * 0.5;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(bx + px * w, by + py * w);
        ctx.lineTo(bx - px * w, by - py * w);
        ctx.closePath();
        ctx.fillStyle = '#111';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fill();
      }
    }
    // תווית מספר
    ctx.beginPath();
    ctx.arc(lx, ly, r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.strokeStyle = style.highlightId === m.id ? '#d6336c' : '#111';
    ctx.stroke();
    const digits = String(m.num).length;
    ctx.fillStyle = '#111';
    ctx.font = `bold ${r * (digits >= 3 ? 0.88 : digits === 2 ? 1.05 : 1.25)}px ${HEADER_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(m.num), lx, ly + r * 0.06);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* ציור עמוד שלם                                                        */
/* ------------------------------------------------------------------ */

function rtlText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign, font: string, color = '#111') {
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export interface RenderOptions {
  scale: number;
  markSize: MarkSize;
  showMarks?: boolean;
}

export function renderPage(layout: PageLayout, els: Map<string, HTMLImageElement>, opt: RenderOptions): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(layout.paperW * opt.scale);
  c.height = Math.round(layout.paperH * opt.scale);
  const ctx = c.getContext('2d')!;
  ctx.scale(opt.scale, opt.scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, layout.paperW, layout.paperH);
  ctx.imageSmoothingQuality = 'high';

  const right = layout.paperW - MARGIN;
  let y = MARGIN;

  // כותרת והוראות
  if (layout.titleLines.length) {
    for (const line of layout.titleLines) {
      y += 17;
      rtlText(ctx, line, layout.paperW / 2, y, 'center', FONT.title);
      y += 7;
    }
    y += 4;
  }
  for (const line of layout.instructionLines) {
    y += 13;
    rtlText(ctx, line, right, y, 'right', FONT.body);
    y += 4;
  }

  // תמונות
  for (const p of layout.images) {
    const el = els.get(p.image.id);
    if (el) {
      ctx.drawImage(el, p.rect.x, p.rect.y, p.rect.w, p.rect.h);
      ctx.strokeStyle = '#bbb';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(p.rect.x, p.rect.y, p.rect.w, p.rect.h);
      if (opt.showMarks !== false) drawMarks(ctx, p.image.marks, p.rect, { radius: MARK_RADIUS[opt.markSize] });
    }
    if (p.caption) rtlText(ctx, p.caption, p.rect.x + p.rect.w / 2, p.rect.y + p.rect.h + 12, 'center', FONT.caption);
  }

  // טבלה
  if (layout.table) drawTable(ctx, layout);

  // קרדיטים
  if (layout.creditLines.length) {
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(MARGIN, layout.creditsTop - 2);
    ctx.lineTo(right, layout.creditsTop - 2);
    ctx.stroke();
    let cy = layout.creditsTop + 7;
    for (const line of layout.creditLines) {
      rtlText(ctx, line, right, cy, 'right', FONT.credit, '#333');
      cy += 9.5;
    }
  }

  if (layout.pageCount > 1) {
    rtlText(ctx, `עמוד ${layout.pageNo} מתוך ${layout.pageCount}`, layout.paperW / 2, layout.paperH - 16, 'center', `9px ${HEADER_FONT}`, '#666');
  }
  return c;
}

function drawTable(ctx: CanvasRenderingContext2D, layout: PageLayout) {
  const t = layout.table!;
  const { x, y, w } = t.rect;
  const right = x + w;

  // הנחיה מעל הטבלה
  if (t.instrLines.length) {
    let iy = y - t.instrLines.length * 16 - 6 + 12;
    for (const line of t.instrLines) {
      rtlText(ctx, line, right, iy, 'right', FONT.body);
      iy += 16;
    }
  }

  const gridH = t.headerH + t.rowH * t.rows.length;
  ctx.save();
  ctx.fillStyle = '#e8eef8';
  ctx.fillRect(x, y, w, t.headerH);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 0.9;
  ctx.strokeRect(x, y, w, gridH);
  for (let i = 0; i <= t.rows.length; i++) {
    const yy = y + t.headerH + i * t.rowH;
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(right, yy);
    ctx.stroke();
  }
  // עמודות מימין לשמאל
  let cx = right;
  const spans: { key: string; r: number; l: number }[] = [];
  for (const c of t.columns) {
    spans.push({ key: c.key, r: cx, l: cx - c.w });
    cx -= c.w;
    if (cx > x + 1) {
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(cx, y + gridH);
      ctx.stroke();
    }
  }
  ctx.restore();

  t.columns.forEach((c, i) => {
    const sp = spans[i];
    const mid = (sp.r + sp.l) / 2;
    const lineH = 15;
    const startY = y + (t.headerH - c.lines.length * lineH) / 2 + 11;
    c.lines.forEach((line, k) => rtlText(ctx, line, mid, startY + k * lineH, 'center', FONT.table));
  });
  t.rows.forEach((r, i) => {
    const cy = y + t.headerH + i * t.rowH + t.rowH / 2 + 4.3;
    t.columns.forEach((c, k) => {
      const sp = spans[k];
      const mid = (sp.r + sp.l) / 2;
      if (c.key === 'fig' && r.figure) rtlText(ctx, r.figure, mid, cy, 'center', FONT.table);
      if (c.key === 'num' && r.number) rtlText(ctx, r.number, mid, cy, 'center', FONT.table);
    });
  });
}

/** תמונה בודדת עם הסימונים שלה, ברזולוציה מלאה (ל-DOCX ול-PNG) */
export function renderMarkedImage(
  image: ExamImage,
  el: HTMLImageElement,
  markSize: MarkSize,
  placedWidthPt: number,
  maxSide = 1800,
): HTMLCanvasElement {
  const sc = Math.min(1, maxSide / Math.max(image.width, image.height));
  const w = Math.round(image.width * sc);
  const h = Math.round(image.height * sc);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(el, 0, 0, w, h);
  // גודל המספרים בפיקסלים כך שיהיה זהה לגודלם כשהתמונה מוצבת ברוחב placedWidthPt
  const radiusPx = (MARK_RADIUS[markSize] * w) / Math.max(placedWidthPt, 50);
  drawMarks(ctx, image.marks, { x: 0, y: 0, w, h }, { radius: radiusPx });
  return c;
}

export function canvasToBlob(c: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality = 0.93): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('יצירת הקובץ נכשלה'))), type, quality));
}
