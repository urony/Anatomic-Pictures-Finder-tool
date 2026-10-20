import { useState } from 'react';
import type { ExamImage, Settings } from '../types';
import { PagePreview, type PreviewInfo } from './PagePreview';

interface Props {
  images: ExamImage[];
  settings: Settings;
  setSettings: (s: Settings) => void;
  onReorder: (from: number, to: number) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  goBack: () => void;
  goNext: () => void;
}

export function LayoutStep({ images, settings, setSettings, onReorder, onMove, goBack, goNext }: Props) {
  const [info, setInfo] = useState<PreviewInfo>({ pages: 0, warnings: [] });
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const set = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch });

  const applyTemplate = (t: Settings['template']) => {
    if (t === 'exam') set({ template: 'exam', showTable: true, tableRatio: 0.34, perPage: Math.min(settings.perPage, 2) || 1 });
    else if (t === 'images') set({ template: 'images', showTable: false });
    else set({ template: 'custom' });
  };

  if (images.length === 0) {
    return <div className="empty-step"><p>עוד לא נבחרו תמונות.</p><button className="btn primary" onClick={goBack}>חזרה</button></div>;
  }

  return (
    <div className="layout-layout">
      <aside className="layout-side">
        <h3>תבנית</h3>
        <div className="seg vertical">
          <button className={settings.template === 'exam' ? 'on' : ''} onClick={() => applyTemplate('exam')}>מבחן עם טבלה</button>
          <button className={settings.template === 'images' ? 'on' : ''} onClick={() => applyTemplate('images')}>תמונות בלבד</button>
          <button className={settings.template === 'custom' ? 'on' : ''} onClick={() => applyTemplate('custom')}>פריסה מותאמת</button>
        </div>

        <h3>כותרת והוראות</h3>
        <label>
          כותרת
          <input type="text" value={settings.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label>
          הוראות לתלמיד
          <textarea rows={3} value={settings.instructions} onChange={(e) => set({ instructions: e.target.value })} />
        </label>

        <h3>תמונות בעמוד</h3>
        <div className="seg">
          {[1, 2, 3, 4, 6].map((n) => (
            <button key={n} className={settings.perPage === n ? 'on' : ''} onClick={() => set({ perPage: n, template: settings.template === 'exam' && n > 2 ? 'custom' : settings.template })}>
              {n}
            </button>
          ))}
        </div>

        <label className="check">
          <input type="checkbox" checked={settings.showTable} onChange={(e) => set({ showTable: e.target.checked, template: 'custom' })} />
          טבלת תשובות ריקה
        </label>
        {settings.showTable && (
          <>
            <label>
              חלק הטבלה בעמוד: {Math.round(settings.tableRatio * 100)}%
              <input type="range" min={15} max={60} step={1} value={Math.round(settings.tableRatio * 100)} onChange={(e) => set({ tableRatio: Number(e.target.value) / 100, template: 'custom' })} />
            </label>
            <label>
              שורות נוספות בטבלה
              <input type="number" min={0} max={30} value={settings.extraRows} onChange={(e) => set({ extraRows: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} />
            </label>
          </>
        )}

        <label className="check">
          <input type="checkbox" checked={settings.showCaptions} onChange={(e) => set({ showCaptions: e.target.checked })} />
          כיתוב "איור א׳, ב׳…" מתחת לתמונות
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.showCredits} onChange={(e) => set({ showCredits: e.target.checked })} />
          קרדיט תמונות בתחתית העמוד
        </label>
        {!settings.showCredits && images.some((i) => i.source !== 'upload') && (
          <p className="small warn">רישיונות רבים (כמו CC BY) מחייבים קרדיט. כדאי להשאיר אותו מופעל, או לציין את הקרדיט בדרך אחרת.</p>
        )}

        <h3>נייר</h3>
        <div className="row">
          <select value={settings.paper} onChange={(e) => set({ paper: e.target.value as Settings['paper'] })}>
            <option value="A4">A4</option>
            <option value="Letter">Letter</option>
          </select>
          <select value={settings.landscape ? 'l' : 'p'} onChange={(e) => set({ landscape: e.target.value === 'l' })}>
            <option value="p">לאורך</option>
            <option value="l">לרוחב</option>
          </select>
        </div>

        <h3>סדר התמונות</h3>
        <ol className="order-list">
          {images.map((im, i) => (
            <li
              key={im.id}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIdx !== null) onReorder(dragIdx, i);
                setDragIdx(null);
              }}
              className={dragIdx === i ? 'dragging' : ''}
            >
              <span className="grip" aria-hidden>⠿</span>
              <img src={im.dataUrl} alt="" />
              <span className="t" title={im.title}>{im.title}</span>
              <button title="למעלה" disabled={i === 0} onClick={() => onMove(im.id, -1)}>▲</button>
              <button title="למטה" disabled={i === images.length - 1} onClick={() => onMove(im.id, 1)}>▼</button>
            </li>
          ))}
        </ol>
      </aside>

      <section className="layout-main">
        <div className="layout-head">
          <div>
            <strong>{info.pages} עמודים</strong>
            {info.warnings.length === 0 && <span className="ok-tag"> · אין התראות</span>}
          </div>
          <div className="row">
            <button className="btn" onClick={goBack}>→ חזרה לסימון</button>
            <button className="btn primary" onClick={goNext}>המשך להורדה ←</button>
          </div>
        </div>
        {info.warnings.length > 0 && (
          <ul className="warnings">
            {info.warnings.map((w, i) => (
              <li key={i}>עמוד {w.page}: {w.text}</li>
            ))}
          </ul>
        )}
        <PagePreview images={images} settings={settings} onInfo={setInfo} />
      </section>
    </div>
  );
}
