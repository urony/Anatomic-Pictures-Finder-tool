import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, type Cover, type ExamImage, type Mark, type Settings } from './types';
import { SearchStep } from './components/SearchStep';
import { MarkStep } from './components/MarkStep';
import { LayoutStep } from './components/LayoutStep';
import { ExportStep } from './components/ExportStep';
import { exportProject, downloadBlob, importFromProject, safeFilename } from './lib/exporters';

export type Step = 'search' | 'mark' | 'layout' | 'export';
type Snapshot = Record<string, { marks: Mark[]; covers: Cover[] }>;

const STEPS: { id: Step; label: string }[] = [
  { id: 'search', label: '1. חיפוש ובחירה' },
  { id: 'mark', label: '2. סימון' },
  { id: 'layout', label: '3. עימוד' },
  { id: 'export', label: '4. הורדה' },
];

export interface Toast {
  kind: 'info' | 'error' | 'ok';
  text: string;
}

export function App() {
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState<Step>('search');
  const [images, setImages] = useState<ExamImage[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [toast, setToast] = useState<Toast | null>(null);
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const [, force] = useState(0);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const fileInput = useRef<HTMLInputElement>(null);

  const notify = useCallback((t: Toast) => {
    setToast(t);
    window.setTimeout(() => setToast((cur) => (cur === t ? null : cur)), 6000);
  }, []);

  const snapshot = (): Snapshot => Object.fromEntries(imagesRef.current.map((i) => [i.id, { marks: i.marks, covers: i.covers ?? [] }]));
  const applySnapshot = (snap: Snapshot) =>
    setImages((prev) => prev.map((i) => (snap[i.id] ? { ...i, marks: snap[i.id].marks, covers: snap[i.id].covers } : i)));

  /** נקרא לפני שינוי סימונים שרוצים שיהיה אפשר לבטל */
  const recordHistory = useCallback(() => {
    undoStack.current.push(snapshot());
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    force((n) => n + 1);
  }, []);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(snapshot());
    applySnapshot(prev);
    force((n) => n + 1);
  }, []);
  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(snapshot());
    applySnapshot(next);
    force((n) => n + 1);
  }, []);

  const setMarks = useCallback((imageId: string, marks: Mark[]) => {
    setImages((prev) => prev.map((i) => (i.id === imageId ? { ...i, marks } : i)));
  }, []);

  const setCovers = useCallback((imageId: string, covers: Cover[]) => {
    setImages((prev) => prev.map((i) => (i.id === imageId ? { ...i, covers } : i)));
  }, []);

  const addImage = useCallback((img: ExamImage) => setImages((p) => [...p, img]), []);
  const removeImage = useCallback((id: string) => {
    setImages((p) => p.filter((i) => i.id !== id));
    undoStack.current = [];
    redoStack.current = [];
    force((n) => n + 1);
  }, []);
  const moveImage = useCallback((id: string, dir: -1 | 1) => {
    setImages((p) => {
      const i = p.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.length) return p;
      const copy = [...p];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }, []);
  const reorderImage = useCallback((from: number, to: number) => {
    setImages((p) => {
      if (from === to || from < 0 || to < 0 || from >= p.length || to >= p.length) return p;
      const copy = [...p];
      const [it] = copy.splice(from, 1);
      copy.splice(to, 0, it);
      return copy;
    });
  }, []);

  // התראה לפני סגירה כשיש עבודה שלא נשמרה
  const dirty = images.length > 0;
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // קיצורי מקלדת לביטול / שחזור
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [undo, redo]);

  const saveProject = () => {
    downloadBlob(exportProject(images, settings), safeFilename(settings.title + ' (פרויקט)', 'anatomy.json'));
    notify({ kind: 'ok', text: 'הפרויקט נשמר לקובץ במחשב.' });
  };

  const openProject = async (file: File) => {
    try {
      const { images: imgs, settings: s } = importFromProject(await file.text());
      setImages(imgs);
      setSettings(s);
      undoStack.current = [];
      redoStack.current = [];
      setStarted(true);
      setStep(imgs.length ? 'mark' : 'search');
      notify({ kind: 'ok', text: `הפרויקט נפתח (${imgs.length} תמונות).` });
    } catch (e) {
      notify({ kind: 'error', text: (e as Error).message });
    }
  };

  const totalMarks = useMemo(() => images.reduce((n, i) => n + i.marks.length, 0), [images]);
  const narrow = typeof window !== 'undefined' && window.innerWidth < 860;

  if (!started) {
    return (
      <div className="landing">
        <div className="landing-card">
          <div className="logo" aria-hidden>🫀</div>
          <h1>בונה מבחני אנטומיה</h1>
          <p className="lead">
            מצאו תמונות אנטומיות ממאגרים פתוחים, סמנו עליהן מספרים והורידו דף מבחן עם טבלת תשובות — בכמה דקות, בלי הרשמה ובחינם.
          </p>
          <div className="landing-actions">
            <button className="btn primary big" onClick={() => setStarted(true)}>
              חפש תמונות
            </button>
            <button className="btn big" onClick={() => fileInput.current?.click()}>
              פתיחת פרויקט שמור
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openProject(f);
              e.target.value = '';
            }}
          />
          <ol className="how">
            <li>חפשו איבר או מערכת בעברית</li>
            <li>בחרו תמונות וראו מקור ורישיון</li>
            <li>סמנו מספרים וחצים</li>
            <li>סדרו בעמוד והורידו PDF / Word</li>
          </ol>
          {narrow && <p className="warn-box">הכלי מיועד לשימוש במחשב. במסך קטן העבודה תהיה פחות נוחה.</p>}
          <p className="credit-line">פותח על ידי אורי העליון</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => setStarted(false)} title="למסך הפתיחה">
          🫀 בונה מבחני אנטומיה
        </div>
        <nav className="steps" aria-label="שלבי העבודה">
          {STEPS.map((s) => (
            <button key={s.id} className={'step' + (step === s.id ? ' active' : '')} onClick={() => setStep(s.id)}>
              {s.label}
              {s.id === 'search' && images.length > 0 && <span className="pill">{images.length}</span>}
              {s.id === 'mark' && totalMarks > 0 && <span className="pill">{totalMarks}</span>}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <button className="btn small" onClick={saveProject} disabled={!images.length} title="שמירת הפרויקט כקובץ במחשב">
            שמור פרויקט
          </button>
          <button className="btn small" onClick={() => fileInput.current?.click()} title="פתיחת פרויקט שנשמר">
            פתח פרויקט
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openProject(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      {narrow && <div className="warn-box top">הכלי מיועד לשימוש במחשב.</div>}

      <main>
        {step === 'search' && (
          <SearchStep
            images={images}
            onAdd={addImage}
            onRemove={removeImage}
            onMove={moveImage}
            onNext={() => setStep('mark')}
            notify={notify}
          />
        )}
        {step === 'mark' && (
          <MarkStep
            images={images}
            settings={settings}
            setSettings={setSettings}
            setMarks={setMarks}
            setCovers={setCovers}
            recordHistory={recordHistory}
            undo={undo}
            redo={redo}
            canUndo={undoStack.current.length > 0}
            canRedo={redoStack.current.length > 0}
            goSearch={() => setStep('search')}
            goNext={() => setStep('layout')}
          />
        )}
        {step === 'layout' && (
          <LayoutStep
            images={images}
            settings={settings}
            setSettings={setSettings}
            onReorder={reorderImage}
            onMove={moveImage}
            goBack={() => setStep('mark')}
            goNext={() => setStep('export')}
          />
        )}
        {step === 'export' && <ExportStep images={images} settings={settings} goBack={() => setStep('layout')} notify={notify} />}
      </main>

      {toast && (
        <div className={'toast ' + toast.kind} role="status" onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
