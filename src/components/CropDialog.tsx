import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExamImage } from '../types';
import { FULL, cropSource, currentRect, remapAnnotations, type Rect01 } from '../lib/crop';
import { loadHtmlImage } from '../lib/imageLoad';
import { drawCovers, drawMarks } from '../lib/render';
import { MARK_RADIUS } from '../lib/layout';

interface Props {
  image: ExamImage;
  onApply: (rect: Rect01 | null) => void;
  onClose: () => void;
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';
type Drag =
  | { kind: 'new'; sx: number; sy: number }
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'resize'; corner: Corner }
  | null;

const MAX_W = 760;
const MAX_H = 480;
const MIN = 0.03;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const RATIOS: { id: string; label: string; v: number | null }[] = [
  { id: 'free', label: 'חופשי', v: null },
  { id: '1', label: '1:1 (ריבוע)', v: 1 },
  { id: '4:3', label: '4:3 לרוחב', v: 4 / 3 },
  { id: '3:4', label: '3:4 לאורך', v: 3 / 4 },
  { id: '16:9', label: '16:9', v: 16 / 9 },
];

/** חלון חיתוך: גוררים מלבן על התמונה; הסימונים וההסתרות מוזזים אוטומטית */
export function CropDialog({ image, onApply, onClose }: Props) {
  const src = useMemo(() => cropSource(image), [image]);
  const [el, setEl] = useState<HTMLImageElement | null>(null);
  const [rect, setRect] = useState<Rect01>(() => (image.crop ? currentRect(image) : { x: 0.08, y: 0.08, w: 0.84, h: 0.84 }));
  const [ratio, setRatio] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag>(null);

  useEffect(() => {
    let alive = true;
    loadHtmlImage(src.dataUrl).then((e) => alive && setEl(e)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [src.dataUrl]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const scale = Math.min(MAX_W / src.width, MAX_H / src.height);
  const dw = Math.round(src.width * scale);
  const dh = Math.round(src.height * scale);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !el) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = dw * dpr;
    cv.height = dh * dpr;
    cv.style.width = `${dw}px`;
    cv.style.height = `${dh}px`;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(el, 0, 0, dw, dh);
    // מציגים את הסימונים וההסתרות הקיימים על התמונה המקורית, כדי לראות מה ייכנס למסגרת ומה יימחק
    const r0 = currentRect(image);
    const toSrc = (v: number, o: number, s: number) => o + v * s;
    const full = { x: 0, y: 0, w: dw, h: dh };
    drawCovers(ctx, (image.covers ?? []).map((c) => ({ ...c, x: toSrc(c.x, r0.x, r0.w), y: toSrc(c.y, r0.y, r0.h), w: c.w * r0.w, h: c.h * r0.h })), full);
    drawMarks(
      ctx,
      image.marks.map((m) => ({ ...m, tx: toSrc(m.tx, r0.x, r0.w), ty: toSrc(m.ty, r0.y, r0.h), lx: toSrc(m.lx, r0.x, r0.w), ly: toSrc(m.ly, r0.y, r0.h) })),
      full,
      { radius: MARK_RADIUS.medium * 0.9 },
    );
    // מעמעמים את מה שמחוץ למלבן
    const rx = rect.x * dw;
    const ry = rect.y * dh;
    const rw = rect.w * dw;
    const rh = rect.h * dh;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, dw, ry);
    ctx.fillRect(0, ry + rh, dw, dh - ry - rh);
    ctx.fillRect(0, ry, rx, rh);
    ctx.fillRect(rx + rw, ry, dw - rx - rw, rh);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#0b6e8a';
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.setLineDash([]);
    for (const [hx, hy] of [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]]) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#0b6e8a';
      ctx.fillRect(hx - 5, hy - 5, 10, 10);
      ctx.strokeRect(hx - 5, hy - 5, 10, 10);
    }
  }, [el, rect, dw, dh, image]);

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / dw), y: clamp01((e.clientY - r.top) / dh), px: e.clientX - r.left, py: e.clientY - r.top };
  };

  /** בונה מלבן מנקודת עוגן ונקודת גרירה, עם נעילת יחס אם נבחר */
  const fromAnchor = (ax: number, ay: number, x: number, y: number): Rect01 => {
    let w = Math.abs(x - ax);
    let h = Math.abs(y - ay);
    if (ratio) {
      // היחס נמדד בפיקסלים של התמונה המקורית
      const wpx = w * src.width;
      const hpx = h * src.height;
      if (wpx / Math.max(hpx, 1e-6) > ratio) w = (hpx * ratio) / src.width;
      else h = wpx / ratio / src.height;
    }
    const dirX = x >= ax ? 1 : -1;
    const dirY = y >= ay ? 1 : -1;
    let nx = dirX > 0 ? ax : ax - w;
    let ny = dirY > 0 ? ay : ay - h;
    nx = Math.max(0, Math.min(1 - w, nx));
    ny = Math.max(0, Math.min(1 - h, ny));
    w = Math.min(w, 1);
    h = Math.min(h, 1);
    return { x: nx, y: ny, w, h };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pos(e);
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const pts: [Corner, number, number][] = [
      ['tl', rect.x * dw, rect.y * dh],
      ['tr', (rect.x + rect.w) * dw, rect.y * dh],
      ['bl', rect.x * dw, (rect.y + rect.h) * dh],
      ['br', (rect.x + rect.w) * dw, (rect.y + rect.h) * dh],
    ];
    const hit = pts.find(([, hx, hy]) => Math.hypot(hx - p.px, hy - p.py) <= 11);
    if (hit) {
      dragRef.current = { kind: 'resize', corner: hit[0] };
      return;
    }
    const nearlyFull = rect.w > 0.95 && rect.h > 0.95; // כשהמסגרת היא כל התמונה, גרירה בפנים מתחילה מסגרת חדשה
    if (!nearlyFull && p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h) {
      dragRef.current = { kind: 'move', dx: p.x - rect.x, dy: p.y - rect.y };
      return;
    }
    dragRef.current = { kind: 'new', sx: p.x, sy: p.y };
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const p = pos(e);
    if (d.kind === 'new') setRect(fromAnchor(d.sx, d.sy, p.x, p.y));
    else if (d.kind === 'move') setRect((r) => ({ ...r, x: Math.min(1 - r.w, Math.max(0, p.x - d.dx)), y: Math.min(1 - r.h, Math.max(0, p.y - d.dy)) }));
    else {
      // העוגן הוא הפינה שממול
      const ax = d.corner === 'tl' || d.corner === 'bl' ? rect.x + rect.w : rect.x;
      const ay = d.corner === 'tl' || d.corner === 'tr' ? rect.y + rect.h : rect.y;
      setRect(fromAnchor(ax, ay, p.x, p.y));
    }
  };

  const onUp = () => {
    dragRef.current = null;
    setRect((r) => (r.w < MIN || r.h < MIN ? FULL : r));
  };

  const preview = useMemo(() => remapAnnotations(image, rect), [image, rect]);
  const changed = Math.abs(rect.x) > 1e-4 || Math.abs(rect.y) > 1e-4 || rect.w < 0.9999 || rect.h < 0.9999;
  const isCropped = !!image.crop;
  const nd = /\bND\b|noderiv/i.test(image.license.name);
  const outPx = { w: Math.round(rect.w * src.width), h: Math.round(rect.h * src.height) };

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="חיתוך תמונה">
      <div className="crop-card">
        <div className="crop-head">
          <h3>חיתוך התמונה</h3>
          <button className="lb-close static" onClick={onClose} aria-label="סגירה">✕</button>
        </div>
        <p className="muted small">גררו על התמונה כדי לבחור את החלק שיישאר. אפשר להזיז את המסגרת ולשנות גודל מהפינות.{image.marks.length > 0 ? ' המספרים שכבר הנחתם מוצגים על התמונה — אלה שבתוך המסגרת יישארו וימשיכו להתאים למבנים.' : ' טיפ: חתכו לפני שמסמנים מספרים.'}</p>
        <div className="crop-stage">{el ? <canvas ref={canvasRef} className="crop-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} /> : <div className="muted">טוען…</div>}</div>
        <div className="crop-bar">
          <label>
            יחס
            <select value={RATIOS.find((r) => r.v === ratio)?.id ?? 'free'} onChange={(e) => setRatio(RATIOS.find((r) => r.id === e.target.value)?.v ?? null)}>
              {RATIOS.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </label>
          <span className="muted small" dir="ltr">{outPx.w} × {outPx.h} px</span>
          <button className="btn small" onClick={() => setRect(FULL)}>כל התמונה</button>
        </div>
        {(preview.droppedMarks > 0 || preview.droppedCovers > 0) && (
          <div className="warn-box">
            בחיתוך הזה יימחקו {preview.droppedMarks > 0 ? `${preview.droppedMarks} מספרים` : ''}
            {preview.droppedMarks > 0 && preview.droppedCovers > 0 ? ' ו-' : ''}
            {preview.droppedCovers > 0 ? `${preview.droppedCovers} הסתרות` : ''} שנמצאים מחוץ למסגרת.
          </div>
        )}
        {nd && <div className="warn-box">רישיון התמונה אוסר יצירת נגזרות (ND) — חיתוך עלול להיחשב שינוי אסור. בדקו בדף המקור.</div>}
        <div className="crop-actions">
          <button className="btn primary" disabled={!changed} onClick={() => onApply(rect)}>החל חיתוך</button>
          {isCropped && <button className="btn" onClick={() => onApply(null)}>בטל חיתוך (חזרה למקור)</button>}
          <button className="btn" onClick={onClose}>סגור</button>
        </div>
      </div>
    </div>
  );
}
