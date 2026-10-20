import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ExamImage, Mark, MarkSize, Settings } from '../types';
import { MARK_RADIUS } from '../lib/layout';
import { drawMarks, getImageElement } from '../lib/render';
import { uid } from '../lib/imageLoad';

interface Props {
  images: ExamImage[];
  settings: Settings;
  setSettings: (s: Settings) => void;
  setMarks: (imageId: string, marks: Mark[]) => void;
  recordHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  goSearch: () => void;
  goNext: () => void;
}

type Tool = 'number' | 'arrow';
const PAD = 22;
const EDITOR_PX_PER_PT = 1.55;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

type Drag =
  | { kind: 'label'; id: string; moved: boolean }
  | { kind: 'target'; id: string; moved: boolean }
  | { kind: 'new-arrow'; id: string; startX: number; startY: number }
  | null;

export function MarkStep({ images, settings, setSettings, setMarks, recordHistory, undo, redo, canUndo, canRedo, goSearch, goNext }: Props) {
  const [currentId, setCurrentId] = useState<string | null>(images[0]?.id ?? null);
  const [tool, setTool] = useState<Tool>('number');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [boxW, setBoxW] = useState(700);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag>(null);
  const [el, setEl] = useState<HTMLImageElement | null>(null);

  const image = images.find((i) => i.id === currentId) ?? images[0] ?? null;

  useEffect(() => {
    if (!image && images[0]) setCurrentId(images[0].id);
  }, [image, images]);

  useEffect(() => {
    setSelectedId(null);
    setEl(null);
    if (!image) return;
    let alive = true;
    getImageElement(image).then((e) => alive && setEl(e)).catch(() => alive && setEl(null));
    return () => {
      alive = false;
    };
  }, [image?.id]);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const ro = new ResizeObserver(() => setBoxW(node.clientWidth));
    ro.observe(node);
    setBoxW(node.clientWidth);
    return () => ro.disconnect();
  }, [image?.id]);

  const radius = MARK_RADIUS[settings.markSize] * EDITOR_PX_PER_PT;

  // מידות תצוגה
  const geom = useMemo(() => {
    if (!image) return null;
    const maxW = Math.max(300, boxW - PAD * 2 - 4);
    const maxH = 560;
    const fit = Math.min(maxW / image.width, maxH / image.height);
    const dw = image.width * fit * zoom;
    const dh = image.height * fit * zoom;
    return { dw, dh, cw: dw + PAD * 2, ch: dh + PAD * 2 };
  }, [image, boxW, zoom]);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !image || !geom) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(geom.cw * dpr);
    cv.height = Math.round(geom.ch * dpr);
    cv.style.width = `${geom.cw}px`;
    cv.style.height = `${geom.ch}px`;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#eef0f2';
    ctx.fillRect(0, 0, geom.cw, geom.ch);
    ctx.fillStyle = '#fff';
    ctx.fillRect(PAD, PAD, geom.dw, geom.dh);
    ctx.imageSmoothingQuality = 'high';
    if (el) ctx.drawImage(el, PAD, PAD, geom.dw, geom.dh);
    drawMarks(ctx, image.marks, { x: PAD, y: PAD, w: geom.dw, h: geom.dh }, { radius, highlightId: selectedId });
    // ידית יעד לחצים
    for (const m of image.marks) {
      if (!m.line) continue;
      const hx = PAD + m.tx * geom.dw;
      const hy = PAD + m.ty * geom.dh;
      ctx.beginPath();
      ctx.arc(hx, hy, 4, 0, Math.PI * 2);
      ctx.fillStyle = selectedId === m.id ? '#d6336c' : 'rgba(255,255,255,0.9)';
      ctx.fill();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, [image, geom, el, radius, selectedId]);

  useEffect(() => {
    draw();
  }, [draw]);

  /** המספר הפנוי הקטן ביותר בטווח (כל המסמך או התמונה הנוכחית) */
  const nextNumber = (): number => {
    const used = new Set<number>();
    const scope = settings.numbering === 'continuous' ? images : image ? [image] : [];
    for (const im of scope) for (const m of im.marks) used.add(m.num);
    let n = 1;
    while (used.has(n)) n++;
    return n;
  };

  const pointerPos = (e: React.PointerEvent) => {
    const cv = canvasRef.current!;
    const r = cv.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };

  const hit = (px: number, py: number): { id: string; part: 'label' | 'target' } | null => {
    if (!image || !geom) return null;
    for (let i = image.marks.length - 1; i >= 0; i--) {
      const m = image.marks[i];
      if (Math.hypot(PAD + m.lx * geom.dw - px, PAD + m.ly * geom.dh - py) <= radius + 3) return { id: m.id, part: 'label' };
    }
    for (let i = image.marks.length - 1; i >= 0; i--) {
      const m = image.marks[i];
      if (m.line && Math.hypot(PAD + m.tx * geom.dw - px, PAD + m.ty * geom.dh - py) <= 9) return { id: m.id, part: 'target' };
    }
    return null;
  };

  const updateMark = (id: string, patch: Partial<Mark>) => {
    if (!image) return;
    setMarks(image.id, image.marks.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!image || !geom || e.button !== 0) return;
    const { px, py } = pointerPos(e);
    const rx = (px - PAD) / geom.dw;
    const ry = (py - PAD) / geom.dh;
    const h = hit(px, py);
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    if (h) {
      setSelectedId(h.id);
      dragRef.current = { kind: h.part, id: h.id, moved: false };
      return;
    }
    if (rx < -0.02 || rx > 1.02 || ry < -0.02 || ry > 1.02) {
      setSelectedId(null);
      return;
    }
    recordHistory();
    const id = uid('m');
    const x = clamp01(rx);
    const y = clamp01(ry);
    const mark: Mark = { id, num: nextNumber(), tx: x, ty: y, lx: x, ly: y, line: false };
    setMarks(image.id, [...image.marks, mark]);
    setSelectedId(id);
    if (tool === 'arrow') {
      // גוררים מהתווית אל היעד
      dragRef.current = { kind: 'new-arrow', id, startX: px, startY: py };
    }
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d || !image || !geom) return;
    const { px, py } = pointerPos(e);
    const x = clamp01((px - PAD) / geom.dw);
    const y = clamp01((py - PAD) / geom.dh);
    const m = image.marks.find((k) => k.id === d.id);
    if (!m) return;
    if (d.kind === 'new-arrow') {
      if (Math.hypot(px - d.startX, py - d.startY) > radius * 1.2) updateMark(d.id, { tx: x, ty: y, line: true });
      return;
    }
    if (!d.moved) {
      recordHistory();
      d.moved = true;
    }
    if (d.kind === 'label') updateMark(d.id, m.line ? { lx: x, ly: y } : { lx: x, ly: y, tx: x, ty: y });
    else updateMark(d.id, { tx: x, ty: y });
  };

  const onUp = () => {
    dragRef.current = null;
  };

  const selected = image?.marks.find((m) => m.id === selectedId) ?? null;

  const deleteSelected = useCallback(() => {
    if (!image || !selectedId) return;
    recordHistory();
    setMarks(image.id, image.marks.filter((m) => m.id !== selectedId));
    setSelectedId(null);
  }, [image, selectedId, recordHistory, setMarks]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [selectedId, deleteSelected]);

  const toggleArrow = () => {
    if (!selected || !image) return;
    recordHistory();
    if (selected.line) updateMark(selected.id, { line: false, lx: selected.tx, ly: selected.ty });
    else {
      const lx = clamp01(selected.tx + (selected.tx > 0.5 ? -0.12 : 0.12));
      const ly = clamp01(selected.ty - 0.1);
      updateMark(selected.id, { line: true, lx, ly });
    }
  };

  const setNumber = (v: number) => {
    if (!selected || !Number.isFinite(v)) return;
    updateMark(selected.id, { num: Math.max(1, Math.min(999, Math.round(v))) });
  };

  const renumber = () => {
    recordHistory();
    let counter = 0;
    for (const im of images) {
      if (settings.numbering === 'restart') counter = 0;
      const sorted = [...im.marks].sort((a, b) => a.num - b.num);
      const map = new Map<string, number>();
      for (const m of sorted) map.set(m.id, ++counter);
      setMarks(im.id, im.marks.map((m) => ({ ...m, num: map.get(m.id)! })));
    }
  };

  const clearImage = () => {
    if (!image || !image.marks.length) return;
    if (!window.confirm('למחוק את כל הסימונים בתמונה זו? אפשר לבטל עם Ctrl+Z.')) return;
    recordHistory();
    setMarks(image.id, []);
    setSelectedId(null);
  };

  // מספרים כפולים במצב רציף
  const duplicates = useMemo(() => {
    const out: number[] = [];
    if (settings.numbering === 'continuous') {
      const seen = new Map<number, number>();
      for (const im of images) for (const m of im.marks) seen.set(m.num, (seen.get(m.num) ?? 0) + 1);
      for (const [n, c] of seen) if (c > 1) out.push(n);
    } else {
      for (const im of images) {
        const seen = new Set<number>();
        for (const m of im.marks) {
          if (seen.has(m.num)) out.push(m.num);
          seen.add(m.num);
        }
      }
    }
    return [...new Set(out)].sort((a, b) => a - b);
  }, [images, settings.numbering]);

  if (images.length === 0) {
    return (
      <div className="empty-step">
        <p>עוד לא נבחרו תמונות.</p>
        <button className="btn primary" onClick={goSearch}>חזרה לחיפוש</button>
      </div>
    );
  }

  return (
    <div className="mark-layout">
      <aside className="mark-list" aria-label="תמונות">
        {images.map((im, i) => (
          <button key={im.id} className={'mark-thumb' + (im.id === image?.id ? ' active' : '')} onClick={() => setCurrentId(im.id)}>
            <img src={im.dataUrl} alt="" />
            <span className="mt-label">תמונה {i + 1}</span>
            <span className="pill">{im.marks.length}</span>
          </button>
        ))}
        <button className="btn small" onClick={goSearch}>+ הוספת תמונות</button>
      </aside>

      <section className="mark-main">
        <div className="toolbar">
          <div className="seg" role="group" aria-label="כלי סימון">
            <button className={tool === 'number' ? 'on' : ''} onClick={() => setTool('number')} title="לחיצה על התמונה מוסיפה מספר">
              ① מספר
            </button>
            <button className={tool === 'arrow' ? 'on' : ''} onClick={() => setTool('arrow')} title="גרירה מחוץ למבנה אל המבנה מוסיפה מספר עם חץ">
              ↗ מספר עם חץ
            </button>
          </div>
          <button className="btn small" onClick={undo} disabled={!canUndo} title="Ctrl+Z">↶ בטל</button>
          <button className="btn small" onClick={redo} disabled={!canRedo} title="Ctrl+Y">↷ שחזר</button>
          <label className="zoom">
            הגדלה
            <input type="range" min={1} max={4} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
            <span dir="ltr">{Math.round(zoom * 100)}%</span>
          </label>
        </div>
        <p className="hint-line">
          {tool === 'number'
            ? 'לחצו על המבנה כדי להניח מספר. גררו מספר כדי להזיז אותו.'
            : 'לחצו מחוץ למבנה וגררו אל המבנה — יווצר מספר עם חץ. אפשר לגרור גם את קצה החץ.'}
        </p>
        <div className="canvas-wrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className={'editor-canvas' + (tool === 'arrow' ? ' arrow' : '')}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
          {!el && <div className="canvas-loading">טוען תמונה…</div>}
        </div>
        {image && <div className="muted small">{image.title} · {image.width}×{image.height}</div>}
      </section>

      <aside className="mark-side">
        <h3>מספר נבחר</h3>
        {selected ? (
          <div className="panel">
            <label>
              מספר
              <input type="number" min={1} max={999} value={selected.num} onChange={(e) => setNumber(Number(e.target.value))} />
            </label>
            <button className="btn small" onClick={toggleArrow}>{selected.line ? 'הסר חץ' : 'הוסף חץ'}</button>
            <button className="btn small danger" onClick={deleteSelected}>מחק מספר</button>
          </div>
        ) : (
          <p className="muted small">בחרו מספר על התמונה כדי לשנות אותו, להוסיף חץ או למחוק.</p>
        )}

        <h3>מספור</h3>
        <div className="panel">
          <label className="check">
            <input type="radio" name="num" checked={settings.numbering === 'continuous'} onChange={() => setSettings({ ...settings, numbering: 'continuous' })} />
            רציף לאורך כל המבחן
          </label>
          <label className="check">
            <input type="radio" name="num" checked={settings.numbering === 'restart'} onChange={() => setSettings({ ...settings, numbering: 'restart' })} />
            מתחיל מ-1 בכל תמונה
          </label>
          <button className="btn small" onClick={renumber}>מספר מחדש לפי הסדר</button>
          {duplicates.length > 0 && <p className="small warn">שימו לב: המספרים {duplicates.join(', ')} חוזרים יותר מפעם אחת.</p>}
        </div>

        <h3>גודל המספרים</h3>
        <div className="panel">
          <select value={settings.markSize} onChange={(e) => setSettings({ ...settings, markSize: e.target.value as MarkSize })}>
            <option value="small">קטן</option>
            <option value="medium">בינוני</option>
            <option value="large">גדול</option>
          </select>
        </div>

        <button className="btn small" onClick={clearImage} disabled={!image?.marks.length}>נקה את כל הסימונים בתמונה</button>
        <div className="spacer" />
        <button className="btn primary wide" onClick={goNext}>המשך לעימוד ←</button>
      </aside>
    </div>
  );
}
