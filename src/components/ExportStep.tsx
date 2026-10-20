import { useState } from 'react';
import type { ExamImage, Settings } from '../types';
import type { Toast } from '../App';
import { PagePreview, type PreviewInfo } from './PagePreview';
import { downloadBlob, exportDocx, exportMarkedImage, exportPagePng, exportPdf, printDocument, safeFilename } from '../lib/exporters';

interface Props {
  images: ExamImage[];
  settings: Settings;
  goBack: () => void;
  notify: (t: Toast) => void;
}

type Job = 'pdf' | 'docx' | 'png' | 'print' | null;

export function ExportStep({ images, settings, goBack, notify }: Props) {
  const [info, setInfo] = useState<PreviewInfo>({ pages: 0, warnings: [] });
  const [job, setJob] = useState<Job>(null);
  const [prog, setProg] = useState<[number, number] | null>(null);
  const [pngMode, setPngMode] = useState<'page' | 'image'>('page');
  const [pngPage, setPngPage] = useState(0);
  const [pngImage, setPngImage] = useState(0);
  const [pngMarks, setPngMarks] = useState(true);
  const [pngType, setPngType] = useState<'image/png' | 'image/jpeg'>('image/png');

  const run = async (kind: Exclude<Job, null>, fn: () => Promise<void>) => {
    if (job) return;
    setJob(kind);
    setProg(null);
    try {
      await fn();
    } catch (e) {
      notify({ kind: 'error', text: `הפעולה נכשלה: ${(e as Error).message || 'שגיאה לא צפויה'}` });
    } finally {
      setJob(null);
      setProg(null);
    }
  };

  const name = (ext: string) => safeFilename(settings.title, ext);
  const unclear = images.filter((i) => i.license.level === 'unclear' || i.license.level === 'restricted');
  const uploads = images.filter((i) => i.source === 'upload');
  const noMarks = images.filter((i) => i.marks.length === 0);

  return (
    <div className="export-layout">
      <aside className="export-side">
        <h3>הורדה</h3>
        <div className="export-btns">
          <button className="btn primary wide" disabled={!!job || !images.length} onClick={() => run('pdf', async () => {
            const b = await exportPdf(images, settings, (d, t) => setProg([d, t]));
            downloadBlob(b, name('pdf'));
            notify({ kind: 'ok', text: 'קובץ ה-PDF ירד למחשב.' });
          })}>
            {job === 'pdf' ? `מכין PDF… ${prog ? `${prog[0]}/${prog[1]}` : ''}` : '⬇ הורד PDF (להדפסה)'}
          </button>
          <button className="btn wide" disabled={!!job || !images.length} onClick={() => run('docx', async () => {
            const b = await exportDocx(images, settings, (d, t) => setProg([d, t]));
            downloadBlob(b, name('docx'));
            notify({ kind: 'ok', text: 'קובץ ה-Word ירד למחשב.' });
          })}>
            {job === 'docx' ? `מכין Word… ${prog ? `${prog[0]}/${prog[1]}` : ''}` : '⬇ הורד Word (לעריכה)'}
          </button>
          <button className="btn wide" disabled={!!job || !images.length} onClick={() => run('print', async () => {
            await printDocument(images, settings);
          })}>
            🖨 הדפסה ישירה
          </button>
        </div>
        <p className="muted small">
          ב-PDF העמוד נשמר כתמונה חדה (כ־216 dpi), כך שהעברית והמספרים נראים זהים בכל מחשב; הטקסט בו אינו ניתן לסימון. ב-Word הטקסט והטבלה ניתנים לעריכה, והתמונות מגיעות עם הסימונים כחלק מהן.
        </p>

        <h3>ייצוא כתמונה</h3>
        <div className="panel">
          <div className="seg">
            <button className={pngMode === 'page' ? 'on' : ''} onClick={() => setPngMode('page')}>עמוד</button>
            <button className={pngMode === 'image' ? 'on' : ''} onClick={() => setPngMode('image')}>תמונה בודדת</button>
          </div>
          {pngMode === 'page' ? (
            <label>
              עמוד
              <select value={pngPage} onChange={(e) => setPngPage(Number(e.target.value))}>
                {Array.from({ length: Math.max(info.pages, 1) }, (_, i) => (
                  <option key={i} value={i}>עמוד {i + 1}</option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label>
                תמונה
                <select value={pngImage} onChange={(e) => setPngImage(Number(e.target.value))}>
                  {images.map((im, i) => (
                    <option key={im.id} value={i}>{i + 1}. {im.title.slice(0, 40)}</option>
                  ))}
                </select>
              </label>
              <label className="check"><input type="checkbox" checked={pngMarks} onChange={(e) => setPngMarks(e.target.checked)} /> עם מספרים</label>
            </>
          )}
          <label>
            פורמט
            <select value={pngType} onChange={(e) => setPngType(e.target.value as 'image/png' | 'image/jpeg')}>
              <option value="image/png">PNG</option>
              <option value="image/jpeg">JPEG</option>
            </select>
          </label>
          <button className="btn wide" disabled={!!job || !images.length} onClick={() => run('png', async () => {
            const ext = pngType === 'image/png' ? 'png' : 'jpg';
            const b = pngMode === 'page'
              ? await exportPagePng(images, settings, pngPage, pngType)
              : await exportMarkedImage(images[Math.min(pngImage, images.length - 1)], settings, pngMarks, pngType);
            downloadBlob(b, name(ext).replace(`.${ext}`, pngMode === 'page' ? ` - עמוד ${pngPage + 1}.${ext}` : ` - תמונה ${pngImage + 1}.${ext}`));
          })}>
            {job === 'png' ? 'מכין…' : '⬇ הורד תמונה'}
          </button>
        </div>

        <button className="btn" onClick={goBack}>→ חזרה לעימוד</button>
      </aside>

      <section className="export-main">
        <h3>כך זה ייראה בהדפסה</h3>
        <div className="checks">
          {info.warnings.map((w, i) => (
            <div key={i} className="warn-box">עמוד {w.page}: {w.text}</div>
          ))}
          {noMarks.length > 0 && images.length > 0 && (
            <div className="warn-box">{noMarks.length === images.length ? 'עדיין לא סומנו מספרים על התמונות.' : `יש ${noMarks.length} תמונות בלי מספרים.`}</div>
          )}
          {unclear.length > 0 && (
            <div className="warn-box">
              {unclear.length} תמונות עם רישיון לא ברור או מוגבל: {unclear.map((u) => u.title).join(' · ').slice(0, 160)}. בדקו בדף המקור לפני שימוש.
            </div>
          )}
          {uploads.length > 0 && <div className="warn-box">תמונות שהועלו ידנית: האחריות לזכויות השימוש עליכם.</div>}
          {!images.length && <div className="error-box">לא נבחרו תמונות.</div>}
        </div>
        <PagePreview images={images} settings={settings} onInfo={setInfo} />
      </section>
    </div>
  );
}
