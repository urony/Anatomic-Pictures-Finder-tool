import { useState } from 'react';
import { TABLE_INSTR_ALL, TABLE_INSTR_PICK, type ExamImage, type Settings } from '../types';
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

  const setMode = (m: Settings['tableMode']) => {
    const wasDefault = settings.tableInstructions === TABLE_INSTR_ALL || settings.tableInstructions === TABLE_INSTR_PICK;
    set({ tableMode: m, ...(wasDefault ? { tableInstructions: m === 'pick' ? TABLE_INSTR_PICK : TABLE_INSTR_ALL } : {}) });
  };

  const applyTemplate = (t: Settings['template']) => {
    if (t === 'exam') set({ template: 'exam', showTable: true, tableRatio: 0.27, perPage: Math.min(settings.perPage, 2) || 1 });
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
            <h3>סוג הטבלה</h3>
            <div className="seg vertical">
              <button
                className={settings.tableMode === 'all' ? 'on' : ''}
                onClick={() => setMode('all')}
                title="שורה לכל מספר שסומן, והמספרים כבר מודפסים"
              >
                שורה לכל מספר (המספרים מודפסים)
              </button>
              <button
                className={settings.tableMode === 'pick' ? 'on' : ''}
                onClick={() => setMode('pick')}
                title="שורות ריקות; התלמיד בוחר מספרים וכותב אותם בעצמו"
              >
                התלמיד בוחר מספרים (שורות ריקות)
              </button>
            </div>
            {settings.tableMode === 'pick' && (
              <label>
                מספר שורות
                <input type="number" min={1} max={20} value={settings.pickCount} onChange={(e) => set({ pickCount: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} />
              </label>
            )}
            {settings.tableMode === 'all' && (
              <label>
                שורות נוספות בסוף
                <input type="number" min={0} max={30} value={settings.extraRows} onChange={(e) => set({ extraRows: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} />
              </label>
            )}
            <div className="small muted">עמודות בטבלה:</div>
            <label className="check"><input type="checkbox" checked disabled /> מספר, ושם בעברית</label>
            <label className="check">
              <input type="checkbox" checked={settings.tableCols.en} onChange={(e) => set({ tableCols: { ...settings.tableCols, en: e.target.checked } })} />
              שם באנגלית
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.tableCols.fn} onChange={(e) => set({ tableCols: { ...settings.tableCols, fn: e.target.checked } })} />
              אחד מתפקידי החלק/החומר
            </label>
            <label>
              הנחיה מעל הטבלה
              <textarea rows={4} value={settings.tableInstructions} onChange={(e) => set({ tableInstructions: e.target.value })} />
            </label>
            <label>
              גודל הטבלה בעמוד (עד): {Math.round(settings.tableRatio * 100)}%
              <input type="range" min={15} max={45} step={1} value={Math.round(settings.tableRatio * 100)} onChange={(e) => set({ tableRatio: Number(e.target.value) / 100, template: 'custom' })} />
            </label>
            <p className="small muted">הטבלה מתכווצת לפי מספר השורות; אם יש הרבה שורות היא תגדל עד 45% ואז תמשיך בעמוד נוסף. ב-Word אפשר לשנות כל גודל.</p>
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

        <h3>צבע התמונות (להדפסה)</h3>
        <select value={settings.bwMode} onChange={(e) => set({ bwMode: e.target.value as Settings['bwMode'] })}>
          <option value="off">צבעוני (כמו במקור)</option>
          <option value="gray">גווני אפור</option>
          <option value="contrast">שחור-לבן בניגודיות מוגברת</option>
        </select>
        {settings.bwMode === 'contrast' && (
          <label>
            עוצמת הניגודיות: {settings.bwStrength}
            <input type="range" min={0} max={100} step={5} value={settings.bwStrength} onChange={(e) => set({ bwStrength: Number(e.target.value) })} />
          </label>
        )}
        {settings.bwMode !== 'off' && <p className="small muted">חל על התמונות בכל הייצואים (PDF, Word, תמונה, הדפסה). המספרים והחצים נשארים שחורים עם מסגרת לבנה.</p>}

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
