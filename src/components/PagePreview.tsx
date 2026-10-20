import { useEffect, useState } from 'react';
import type { ExamImage, Settings } from '../types';
import { layoutDocument } from '../lib/layout';
import { canvasToBlob, loadElements, renderPage } from '../lib/render';

export interface PreviewInfo {
  pages: number;
  warnings: { page: number; text: string }[];
}

interface Props {
  images: ExamImage[];
  settings: Settings;
  scale?: number;
  onInfo?: (info: PreviewInfo) => void;
}

/** תצוגה מקדימה של העמודים — אותו מנוע עימוד ורינדור כמו בייצוא */
export function PagePreview({ images, settings, scale = 1.35, onInfo }: Props) {
  const [urls, setUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    setBusy(true);
    const t = window.setTimeout(async () => {
      try {
        const layouts = layoutDocument(images, settings);
        onInfo?.({
          pages: layouts.length,
          warnings: layouts.flatMap((l) => l.warnings.map((text) => ({ page: l.pageNo, text }))),
        });
        const els = await loadElements(images);
        const out: string[] = [];
        for (const L of layouts) {
          const c = renderPage(L, els, { scale, markSize: settings.markSize });
          const u = URL.createObjectURL(await canvasToBlob(c, 'image/jpeg', 0.88));
          made.push(u);
          out.push(u);
          if (cancelled) return;
        }
        if (!cancelled) {
          setUrls(out);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message || 'התצוגה המקדימה נכשלה');
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      // משחררים כתובות ישנות רק אחרי שהחדשות הוצגו
      setTimeout(() => made.forEach((u) => URL.revokeObjectURL(u)), 3000);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, settings, scale]);

  return (
    <div className="pages">
      {error && <div className="error-box">{error}</div>}
      {busy && urls.length === 0 && <div className="muted center">מכין תצוגה…</div>}
      {urls.map((u, i) => (
        <figure key={i} className={'page' + (busy ? ' dim' : '')}>
          <img src={u} alt={`עמוד ${i + 1}`} />
          <figcaption>עמוד {i + 1} מתוך {urls.length}</figcaption>
        </figure>
      ))}
    </div>
  );
}
