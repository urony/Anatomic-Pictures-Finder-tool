import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ExamImage, SearchResult, SourceId } from '../types';
import type { Toast } from '../App';
import { expandQuery, suggest, type TermsFile } from '../lib/terms';
import { searchCommons } from '../sources/commons';
import { searchWellcome } from '../sources/wellcome';
import { importLocalFile, importSearchResult } from '../lib/imageLoad';
import { isDefaultSafe, LEVEL_LABEL } from '../lib/license';

type KindFilter = 'all' | 'illustration' | 'photo' | 'imaging' | 'micro';
type ColorFilter = 'all' | 'color' | 'bw';

const QUICK = ['לב', 'כליה', 'מוח', 'ריאות', 'כבד', 'עין', 'אוזן', 'שלד', 'שרירים', 'בלוטת התריס', 'כלי דם', 'מערכת העיכול'];

const KIND_WORDS: Record<KindFilter, { cirrus: string; type: 'any' | 'drawing' | 'bitmap' }> = {
  all: { cirrus: '', type: 'any' },
  illustration: { cirrus: 'illustration', type: 'drawing' },
  photo: { cirrus: 'photograph', type: 'bitmap' },
  imaging: { cirrus: 'CT', type: 'bitmap' },
  micro: { cirrus: 'histology', type: 'bitmap' },
};

interface SourceState {
  status: 'idle' | 'loading' | 'ok' | 'error';
  error?: string;
  next?: number;
  total?: number;
}

interface Props {
  images: ExamImage[];
  onAdd: (img: ExamImage) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onNext: () => void;
  notify: (t: Toast) => void;
}

export function SearchStep({ images, onAdd, onRemove, onMove, onNext, notify }: Props) {
  const [terms, setTerms] = useState<TermsFile | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [color, setColor] = useState<ColorFilter>('all');
  const [useCommons, setUseCommons] = useState(true);
  const [useWellcome, setUseWellcome] = useState(true);
  const [showUnclear, setShowUnclear] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const [results, setResults] = useState<SearchResult[]>([]);
  const [states, setStates] = useState<Record<SourceId, SourceState>>({
    commons: { status: 'idle' },
    wellcome: { status: 'idle' },
    upload: { status: 'idle' },
  });
  const [activeEnglish, setActiveEnglish] = useState<string[]>([]);
  const [englishChoices, setEnglishChoices] = useState<string[]>([]);
  const [searched, setSearched] = useState(false);
  const [noTranslation, setNoTranslation] = useState(false);
  const [colors, setColors] = useState<Record<string, 'color' | 'bw'>>({});
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState<SearchResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/anatomy-terms.json`)
      .then((r) => r.json())
      .then(setTerms)
      .catch(() => setTerms(null));
  }, []);

  const suggestions = useMemo(() => suggest(query, terms), [query, terms]);
  const selectedKeys = useMemo(() => new Set(images.map((i) => `${i.source}:${i.sourceId}`)), [images]);

  const runSearch = useCallback(
    async (rawQuery: string, englishOverride?: string[]) => {
      const q = rawQuery.trim();
      if (!q) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const seq = ++searchSeq.current;

      const exp = expandQuery(q, terms);
      const english = englishOverride ?? exp.english;
      setEnglishChoices(exp.english);
      setActiveEnglish(english);
      setNoTranslation(!exp.matched && !exp.passthrough && !englishOverride);
      // אם אין תרגום — מנסים בכל זאת את הטקסט המקורי (לעיתים יש תיאורים בעברית)
      const term = english[0] ?? q;
      const kw = KIND_WORDS[kind];
      const commonsQuery = [term, kw.cirrus].filter(Boolean).join(' ');
      const wellcomeQuery = term;

      setResults([]);
      setColors({});
      setSearched(true);
      setStates({
        commons: { status: useCommons ? 'loading' : 'idle' },
        wellcome: { status: useWellcome ? 'loading' : 'idle' },
        upload: { status: 'idle' },
      });

      const tasks: Promise<void>[] = [];
      if (useCommons) {
        tasks.push(
          searchCommons(commonsQuery, kw.type, 0, ctrl.signal)
            .then((p) => {
              if (seq !== searchSeq.current) return;
              setResults((r) => [...r, ...p.results]);
              setStates((s) => ({ ...s, commons: { status: 'ok', next: p.next, total: p.total } }));
            })
            .catch((e) => {
              if (ctrl.signal.aborted || seq !== searchSeq.current) return;
              setStates((s) => ({ ...s, commons: { status: 'error', error: 'לא הצלחנו לגשת ל-Wikimedia Commons כרגע.' + (e?.message ? '' : '') } }));
            }),
        );
      }
      if (useWellcome) {
        tasks.push(
          searchWellcome(wellcomeQuery, 1, !showUnclear, ctrl.signal)
            .then((p) => {
              if (seq !== searchSeq.current) return;
              setResults((r) => [...r, ...p.results]);
              setStates((s) => ({ ...s, wellcome: { status: 'ok', next: p.next, total: p.total } }));
            })
            .catch(() => {
              if (ctrl.signal.aborted || seq !== searchSeq.current) return;
              setStates((s) => ({ ...s, wellcome: { status: 'error', error: 'לא הצלחנו לגשת ל-Wellcome Collection כרגע.' } }));
            }),
        );
      }
      await Promise.all(tasks);
    },
    [terms, kind, useCommons, useWellcome, showUnclear],
  );

  const loadMore = async (src: 'commons' | 'wellcome') => {
    const st = states[src];
    if (st.next === undefined) return;
    const ctrl = abortRef.current ?? new AbortController();
    const term = activeEnglish[0] ?? query.trim();
    setStates((s) => ({ ...s, [src]: { ...s[src], status: 'loading' } }));
    try {
      if (src === 'commons') {
        const kw = KIND_WORDS[kind];
        const p = await searchCommons([term, kw.cirrus].filter(Boolean).join(' '), kw.type, st.next, ctrl.signal);
        setResults((r) => [...r, ...p.results.filter((x) => !r.some((y) => y.key === x.key))]);
        setStates((s) => ({ ...s, commons: { status: 'ok', next: p.next, total: p.total } }));
      } else {
        const p = await searchWellcome(term, st.next, !showUnclear, ctrl.signal);
        setResults((r) => [...r, ...p.results.filter((x) => !r.some((y) => y.key === x.key))]);
        setStates((s) => ({ ...s, wellcome: { status: 'ok', next: p.next, total: p.total } }));
      }
    } catch {
      setStates((s) => ({ ...s, [src]: { ...s[src], status: 'error', error: 'טעינת תוצאות נוספות נכשלה.' } }));
    }
  };

  const visible = useMemo(() => {
    // משלבים את המאגרים לסירוגין כדי שלא יוצג מאגר אחד בלבד בראש הרשימה
    const bySrc = (s: SourceId) => results.filter((r) => r.source === s);
    const a = bySrc('commons');
    const b = bySrc('wellcome');
    const merged: SearchResult[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i]) merged.push(a[i]);
      if (b[i]) merged.push(b[i]);
    }
    return merged.filter((r) => {
      if (!showUnclear && !isDefaultSafe(r.license)) return false;
      if (color !== 'all') {
        const c = colors[r.key];
        if (c && c !== color) return false;
      }
      return true;
    });
  }, [results, showUnclear, color, colors]);

  const hiddenCount = results.length - visible.length;

  const add = async (r: SearchResult) => {
    if (adding.has(r.key) || selectedKeys.has(`${r.source}:${r.sourceId}`)) return;
    setAdding((s) => new Set(s).add(r.key));
    try {
      const img = await importSearchResult(r);
      onAdd(img);
    } catch (e) {
      notify({ kind: 'error', text: `${(e as Error).message}` });
    } finally {
      setAdding((s) => {
        const n = new Set(s);
        n.delete(r.key);
        return n;
      });
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      try {
        onAdd(await importLocalFile(f));
      } catch (e) {
        notify({ kind: 'error', text: `${f.name}: ${(e as Error).message}` });
      }
    }
  };

  const anyLoading = states.commons.status === 'loading' || states.wellcome.status === 'loading';

  return (
    <div className="search-layout">
      <section className="search-main">
        <form
          className="search-bar"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch(query);
          }}
        >
          <input
            className="search-input"
            list="term-suggestions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חפשו איבר או מערכת, למשל: לב, כליה, מוח..."
            aria-label="חיפוש תמונה"
            autoFocus
          />
          <datalist id="term-suggestions">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <button className="btn primary" type="submit" disabled={!query.trim() || anyLoading}>
            {anyLoading ? 'מחפש…' : 'חפש'}
          </button>
        </form>

        <div className="chips">
          {QUICK.map((q) => (
            <button
              key={q}
              className="chip"
              onClick={() => {
                setQuery(q);
                void runSearch(q);
              }}
            >
              {q}
            </button>
          ))}
        </div>

        <div className="filters">
          <label>
            סוג תמונה
            <select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
              <option value="all">הכול</option>
              <option value="illustration">איור אנטומי</option>
              <option value="photo">צילום אמיתי</option>
              <option value="imaging">הדמיה (CT / MRI / רנטגן)</option>
              <option value="micro">מיקרוסקופיה / היסטולוגיה</option>
            </select>
          </label>
          <label>
            צבע
            <select value={color} onChange={(e) => setColor(e.target.value as ColorFilter)}>
              <option value="all">הכול</option>
              <option value="color">צבעוני</option>
              <option value="bw">שחור־לבן</option>
            </select>
          </label>
          <button className="linklike" onClick={() => setAdvanced((a) => !a)}>
            {advanced ? 'הסתר הגדרות מתקדמות' : 'הגדרות מתקדמות'}
          </button>
          <button className="btn small" onClick={() => fileRef.current?.click()}>
            ⬆ העלאת תמונה מהמחשב
          </button>
          <input ref={fileRef} type="file" accept="image/*,.svg" multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
        </div>
        {advanced && (
          <div className="advanced">
            <strong>מאגרים:</strong>
            <label className="check"><input type="checkbox" checked={useCommons} onChange={(e) => setUseCommons(e.target.checked)} /> Wikimedia Commons</label>
            <label className="check"><input type="checkbox" checked={useWellcome} onChange={(e) => setUseWellcome(e.target.checked)} /> Wellcome Collection</label>
            <label className="check"><input type="checkbox" checked={showUnclear} onChange={(e) => setShowUnclear(e.target.checked)} /> הצג גם תמונות עם רישיון לא ברור או מוגבל</label>
            <span className="muted">Servier Medical Art: לא זמין לחיפוש חי בגרסה זו.</span>
          </div>
        )}

        {searched && englishChoices.length > 0 && (
          <div className="translation">
            מחפשים במאגרים בשם: <strong dir="ltr">{activeEnglish[0]}</strong>
            {englishChoices.length > 1 && (
              <>
                {' '}· נסו גם:{' '}
                {englishChoices
                  .filter((e) => e !== activeEnglish[0])
                  .map((e) => (
                    <button key={e} className="chip small" dir="ltr" onClick={() => void runSearch(query, [e, ...englishChoices.filter((x) => x !== e)])}>
                      {e}
                    </button>
                  ))}
              </>
            )}
          </div>
        )}
        {searched && noTranslation && (
          <div className="warn-box">
            המונח לא נמצא במילון התרגום. המאגרים עובדים בעיקר באנגלית — נסו להקליד את השם באנגלית (למשל <span dir="ltr">spleen</span>).
          </div>
        )}

        {(['commons', 'wellcome'] as const).map((src) =>
          states[src].status === 'error' ? (
            <div key={src} className="error-box">
              {states[src].error}{' '}
              {(['commons', 'wellcome'] as const).some((o) => o !== src && states[o].status === 'ok')
                ? 'שאר המאגרים ממשיכים לעבוד.'
                : 'בדקו את החיבור לאינטרנט ונסו שוב בעוד רגע.'}
            </div>
          ) : null,
        )}

        {searched && !anyLoading && visible.length === 0 && !(states.commons.status === 'error' || states.wellcome.status === 'error') && (
          <div className="empty">
            לא נמצאו תוצאות מתאימות.
            {hiddenCount > 0 && ' (חלק מהתוצאות הוסתרו בגלל רישיון או מסנן צבע — אפשר להרחיב בהגדרות המתקדמות.)'}
          </div>
        )}
        {!searched && (
          <div className="empty hint">
            התחילו בחיפוש. התוצאות מגיעות בזמן אמת ממאגרים פתוחים — המורה בוחר מה מתאים מבחינה אנטומית ופדגוגית.
          </div>
        )}

        <div className="grid">
          {visible.map((r) => (
            <ResultCard
              key={r.key}
              r={r}
              selected={selectedKeys.has(`${r.source}:${r.sourceId}`)}
              busy={adding.has(r.key)}
              onZoom={() => setZoom(r)}
              onAdd={() => void add(r)}
              onColor={(c) => setColors((m) => (m[r.key] ? m : { ...m, [r.key]: c }))}
            />
          ))}
        </div>

        {searched && hiddenCount > 0 && visible.length > 0 && <p className="muted center">{hiddenCount} תוצאות מוסתרות לפי מסנני הרישיון/הצבע.</p>}

        <div className="more">
          {(['commons', 'wellcome'] as const).map(
            (src) =>
              states[src].next !== undefined && (
                <button key={src} className="btn" disabled={states[src].status === 'loading'} onClick={() => void loadMore(src)}>
                  {states[src].status === 'loading' ? 'טוען…' : `עוד תוצאות מ-${src === 'commons' ? 'Wikimedia Commons' : 'Wellcome'}`}
                </button>
              ),
          )}
        </div>
      </section>

      <aside className="tray" aria-label="התמונות שבחרתי">
        <h2>התמונות שבחרתי ({images.length})</h2>
        {images.length === 0 && <p className="muted">עדיין לא נבחרו תמונות. לחצו "הוסף למבחן" על תמונה.</p>}
        <ul>
          {images.map((im, i) => (
            <li key={im.id}>
              <img src={im.dataUrl} alt="" />
              <div className="tray-info">
                <div className="t" title={im.title}>{im.title}</div>
                <div className="muted small">{im.license.name}</div>
                {im.notes.length > 0 && im.notes.some((n) => n.includes('אחראי') || n.includes('רישיון') || n.includes('מסחרי')) && <div className="small warn">בדקו רישיון</div>}
              </div>
              <div className="tray-btns">
                <button title="הזז למעלה" disabled={i === 0} onClick={() => onMove(im.id, -1)}>▲</button>
                <button title="הזז למטה" disabled={i === images.length - 1} onClick={() => onMove(im.id, 1)}>▼</button>
                <button title="הסר" onClick={() => onRemove(im.id)}>✕</button>
              </div>
            </li>
          ))}
        </ul>
        <button className="btn primary wide" disabled={!images.length} onClick={onNext}>
          המשך לסימון ←
        </button>
      </aside>

      {zoom && (
        <Lightbox
          r={zoom}
          selected={selectedKeys.has(`${zoom.source}:${zoom.sourceId}`)}
          busy={adding.has(zoom.key)}
          onClose={() => setZoom(null)}
          onAdd={() => void add(zoom)}
        />
      )}
    </div>
  );
}

function licenseClass(level: SearchResult['license']['level']): string {
  return level === 'free' || level === 'share' ? 'lic ok' : level === 'restricted' ? 'lic bad' : 'lic mid';
}

function ResultCard({
  r,
  selected,
  busy,
  onZoom,
  onAdd,
  onColor,
}: {
  r: SearchResult;
  selected: boolean;
  busy: boolean;
  onZoom: () => void;
  onAdd: () => void;
  onColor: (c: 'color' | 'bw') => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <article className={'card' + (selected ? ' selected' : '')}>
      <button className="thumb" onClick={onZoom} aria-label={`הגדלה: ${r.title}`}>
        {failed ? (
          <span className="thumb-fail">אין תצוגה מקדימה</span>
        ) : (
          <img
            src={r.thumbUrl}
            alt={r.title}
            loading="lazy"
            crossOrigin="anonymous"
            onError={() => setFailed(true)}
            onLoad={(e) => {
              const c = detectColor(e.currentTarget);
              if (c) onColor(c);
            }}
          />
        )}
      </button>
      <div className="card-body">
        <div className="card-title" title={r.title}>{r.title}</div>
        <div className="badges">
          <span className="src">{r.source === 'commons' ? 'Commons' : 'Wellcome'}</span>
          <span className={licenseClass(r.license.level)} title={r.license.note}>
            {r.license.name}
          </span>
        </div>
        <div className="card-actions">
          <button className="btn small" onClick={onZoom}>הגדל ופרטים</button>
          <button className={'btn small ' + (selected ? '' : 'primary')} disabled={selected || busy} onClick={onAdd}>
            {selected ? '✓ נבחרה' : busy ? 'בודק…' : 'הוסף למבחן'}
          </button>
        </div>
      </div>
    </article>
  );
}

/** מזהה אם תמונה צבעונית או שחור־לבן לפי רוויה ממוצעת בדגימה קטנה */
function detectColor(img: HTMLImageElement): 'color' | 'bw' | null {
  try {
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 40;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, 40, 40);
    const d = ctx.getImageData(0, 0, 40, 40).data;
    let sat = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const max = Math.max(d[i], d[i + 1], d[i + 2]);
      const min = Math.min(d[i], d[i + 1], d[i + 2]);
      if (d[i + 3] < 128) continue;
      sat += max === 0 ? 0 : (max - min) / max;
      n++;
    }
    if (!n) return null;
    return sat / n > 0.09 ? 'color' : 'bw';
  } catch {
    return null;
  }
}

function Lightbox({ r, selected, busy, onClose, onAdd }: { r: SearchResult; selected: boolean; busy: boolean; onClose: () => void; onAdd: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  const big = r.source === 'commons' ? r.thumbUrl.replace(/\/500px-/, '/1280px-') : r.thumbUrl.replace('/full/400,/', '/full/1000,/');
  const [src, setSrc] = useState(big);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lb-card" onClick={(e) => e.stopPropagation()}>
        <button className="lb-close" onClick={onClose} aria-label="סגירה">✕</button>
        <div className="lb-img">
          <img src={src} alt={r.title} onError={() => src !== r.thumbUrl && setSrc(r.thumbUrl)} />
        </div>
        <div className="lb-info">
          <h3>{r.title}</h3>
          <dl>
            <dt>מקור</dt>
            <dd>{r.source === 'commons' ? 'Wikimedia Commons' : 'Wellcome Collection'}</dd>
            <dt>יוצר</dt>
            <dd>{r.author}</dd>
            <dt>רישיון</dt>
            <dd>
              <span className={licenseClass(r.license.level)}>{r.license.name}</span> <span className="muted small">({LEVEL_LABEL[r.license.level]})</span>
              {r.license.url && (
                <> · <a href={r.license.url} target="_blank" rel="noopener noreferrer">תנאי הרישיון</a></>
              )}
              <div className="muted small">{r.license.note}</div>
            </dd>
            {r.width && r.height && (
              <>
                <dt>גודל מקור</dt>
                <dd dir="ltr" style={{ textAlign: 'right' }}>{r.width} × {r.height}</dd>
              </>
            )}
            {r.description && (
              <>
                <dt>תיאור</dt>
                <dd>{r.description}</dd>
              </>
            )}
          </dl>
          {r.pageUrl && (
            <p>
              <a href={r.pageUrl} target="_blank" rel="noopener noreferrer">לדף המקור ←</a>
            </p>
          )}
          <p className="muted small">הכלי אינו מאמת את הדיוק האנטומי של התמונה — ההחלטה בידי המורה.</p>
          <button className="btn primary wide" disabled={selected || busy} onClick={onAdd}>
            {selected ? '✓ נבחרה למבחן' : busy ? 'בודק שאפשר להשתמש בתמונה…' : 'הוסף למבחן'}
          </button>
        </div>
      </div>
    </div>
  );
}
