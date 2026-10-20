import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ExamImage, SearchResult } from '../types';
import type { Toast } from '../App';
import { expandQuery, suggest, type TermsFile } from '../lib/terms';
import { plainTerm, searchCommonsMulti, type KindFilter, type MultiCursor } from '../sources/commons';
import { searchWellcome } from '../sources/wellcome';
import { searchOpenverse } from '../sources/openverse';
import { searchLibrary } from '../sources/library';
import { TOPICS, libraryPhrases, termsForTopic, type Topic, type TopicTerm } from '../lib/topics';
import { importLocalFile, importSearchResult } from '../lib/imageLoad';
import { isDefaultSafe, LEVEL_LABEL } from '../lib/license';

type ColorFilter = 'all' | 'color' | 'bw';
type Src = 'library' | 'commons' | 'wellcome' | 'openverse';
const SRCS: Src[] = ['library', 'commons', 'wellcome', 'openverse'];
const TOPIC_BATCH = 6;
const SRC_LABEL: Record<Src | 'upload', string> = {
  library: 'מאגר המורים',
  commons: 'Wikimedia Commons',
  wellcome: 'Wellcome Collection',
  openverse: 'Openverse',
  upload: 'העלאה ידנית',
};
const SRC_SHORT: Record<Src | 'upload', string> = { library: 'מאגר המורים', commons: 'Commons', wellcome: 'Wellcome', openverse: 'Openverse', upload: 'מקומי' };



interface SourceState {
  status: 'idle' | 'loading' | 'ok' | 'error';
  error?: string;
  /** Wellcome / Openverse: מספר העמוד הבא */
  next?: number;
  /** Commons: מצב ההמשך לכל אסטרטגיית חיפוש */
  cursor?: MultiCursor;
  hasMore?: boolean;
}

const IDLE: Record<Src, SourceState> = { library: { status: 'idle' }, commons: { status: 'idle' }, wellcome: { status: 'idle' }, openverse: { status: 'idle' } };

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
  const [enabled, setEnabled] = useState<Record<Src, boolean>>({ library: true, commons: true, wellcome: true, openverse: false });
  const [showUnclear, setShowUnclear] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const [results, setResults] = useState<SearchResult[]>([]);
  const [states, setStates] = useState<Record<Src, SourceState>>(IDLE);
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
  const termRef = useRef('');
  const [topic, setTopic] = useState<{ topic: Topic; terms: TopicTerm[]; loaded: number; loading: boolean } | null>(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/anatomy-terms.json`)
      .then((r) => r.json())
      .then(setTerms)
      .catch(() => setTerms(null));
  }, []);

  const suggestions = useMemo(() => suggest(query, terms), [query, terms]);
  const selectedKeys = useMemo(() => new Set(images.map((i) => `${i.source}:${i.sourceId}`)), [images]);

  /** מריץ עמוד אחד של מקור נתון; prev = המצב הקודם (להמשך) */
  const fetchSource = useCallback(
    async (src: Src, term: string, prev: SourceState | null, signal: AbortSignal, extra: string[] = []) => {
      if (src === 'library') {
        const r = await searchLibrary([term, ...extra], terms);
        return { results: r, state: { status: 'ok', hasMore: false } as SourceState };
      }
      if (src === 'commons') {
        const r = await searchCommonsMulti(term, kind, prev?.cursor ?? null, signal);
        const hasMore = Object.values(r.cursor.next).some((n) => n !== undefined);
        return { results: r.results, state: { status: 'ok', cursor: r.cursor, hasMore } as SourceState };
      }
      if (src === 'wellcome') {
        const p = await searchWellcome(term, prev?.next ?? 1, !showUnclear, signal);
        return { results: p.results, state: { status: 'ok', next: p.next, hasMore: p.next !== undefined } as SourceState };
      }
      const p = await searchOpenverse(`${plainTerm(term)} anatomy`, prev?.next ?? 1, signal);
      return { results: p.results, state: { status: 'ok', next: p.next, hasMore: p.next !== undefined } as SourceState };
    },
    [kind, showUnclear, terms],
  );

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
      termRef.current = term;
      setTopic(null);

      setResults([]);
      setColors({});
      setSearched(true);
      setStates({
        library: { status: enabled.library ? 'loading' : 'idle' },
        commons: { status: enabled.commons ? 'loading' : 'idle' },
        wellcome: { status: enabled.wellcome ? 'loading' : 'idle' },
        openverse: { status: enabled.openverse ? 'loading' : 'idle' },
      });

      await Promise.all(
        SRCS.filter((s) => enabled[s]).map((src) =>
          fetchSource(src, term, null, ctrl.signal, [q, ...english.slice(1)])
            .then((r) => {
              if (seq !== searchSeq.current) return;
              setResults((prev) => [...prev, ...r.results]);
              setStates((s) => ({ ...s, [src]: r.state }));
            })
            .catch(() => {
              if (ctrl.signal.aborted || seq !== searchSeq.current) return;
              setStates((s) => ({ ...s, [src]: { status: 'error', error: `לא הצלחנו לגשת ל-${SRC_LABEL[src]} כרגע.` } }));
            }),
        ),
      );
    },
    [terms, enabled, fetchSource],
  );

  const loadMore = async (src: Src) => {
    const st = states[src];
    if (!st.hasMore) return;
    const ctrl = abortRef.current ?? new AbortController();
    setStates((s) => ({ ...s, [src]: { ...s[src], status: 'loading' } }));
    try {
      const r = await fetchSource(src, termRef.current || activeEnglish[0] || query.trim(), st, ctrl.signal);
      setResults((prev) => [...prev, ...r.results.filter((x) => !prev.some((y) => y.key === x.key))]);
      setStates((s) => ({ ...s, [src]: r.state }));
    } catch {
      setStates((s) => ({ ...s, [src]: { ...s[src], status: 'error', error: 'טעינת תוצאות נוספות נכשלה.' } }));
    }
  };

  /** חיפוש לפי נושא: מחפש את כל מונחי הנושא מהמילון, בקבוצות של כמה מונחים בכל פעם */
  const loadTopicBatch = useCallback(
    async (t: Topic, terms: TopicTerm[], from: number, signal: AbortSignal, seq: number) => {
      const batch = terms.slice(from, from + TOPIC_BATCH);
      setTopic((cur) => (cur && cur.topic === t ? { ...cur, loading: true } : cur));
      await Promise.all(
        batch.map(async (tt, i) => {
          const idx = from + i;
          try {
            let r = await searchCommonsMulti(tt.en, 'illustration', null, signal, 4);
            if (r.results.length === 0) r = await searchCommonsMulti(tt.en, 'all', null, signal, 4);
            if (seq !== searchSeq.current) return;
            const tagged = r.results.slice(0, 8).map((x) => ({ ...x, topic: tt.he, topicIdx: idx }));
            setResults((prev) => [...prev, ...tagged.filter((x) => !prev.some((y) => y.key === x.key))]);
          } catch {
            /* מונח שנכשל לא עוצר את השאר */
          }
        }),
      );
      if (seq !== searchSeq.current) return;
      setTopic((cur) => (cur && cur.topic === t ? { ...cur, loaded: from + batch.length, loading: false } : cur));
    },
    [],
  );

  const runTopic = useCallback(
    async (t: Topic) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const seq = ++searchSeq.current;
      const topicTerms = termsForTopic(t, terms);
      setQuery(t.label);
      setSearched(true);
      setResults([]);
      setColors({});
      setEnglishChoices([]);
      setActiveEnglish([]);
      setNoTranslation(false);
      setStates({ ...IDLE, commons: { status: 'loading' }, library: { status: enabled.library ? 'loading' : 'idle' } });
      setTopic({ topic: t, terms: topicTerms, loaded: 0, loading: true });
      if (enabled.library) {
        searchLibrary(libraryPhrases(t), terms)
          .then((lib) => {
            if (seq !== searchSeq.current) return;
            setResults((prev) => [...lib.map((x) => ({ ...x, topic: 'מאגר המורים', topicIdx: -1 })), ...prev]);
            setStates((s) => ({ ...s, library: { status: 'ok' } }));
          })
          .catch(() => setStates((s) => ({ ...s, library: { status: 'ok' } })));
      }
      await loadTopicBatch(t, topicTerms, 0, ctrl.signal, seq);
      if (seq === searchSeq.current) setStates((s) => ({ ...s, commons: { status: 'ok' } }));
    },
    [terms, enabled.library, loadTopicBatch],
  );

  const moreTopicTerms = async () => {
    if (!topic || topic.loading) return;
    const ctrl = abortRef.current ?? new AbortController();
    await loadTopicBatch(topic.topic, topic.terms, topic.loaded, ctrl.signal, searchSeq.current);
  };

  const visible = useMemo(() => {
    // משלבים את המאגרים לסירוגין כדי שלא יוצג מאגר אחד בלבד בראש הרשימה
    // כל תמונות מאגר המורים קודם; אחריהן שאר המאגרים לסירוגין
    const libraryFirst = results.filter((r) => r.source === 'library');
    const lists = SRCS.filter((s) => s !== 'library').map((s) => results.filter((r) => r.source === s));
    const merged: SearchResult[] = [...libraryFirst];
    const longest = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < longest; i++) for (const l of lists) if (l[i]) merged.push(l[i]);
    const ordered = topic ? [...merged].sort((a, b) => (a.topicIdx ?? 0) - (b.topicIdx ?? 0)) : merged;
    return ordered.filter((r) => {
      if (!showUnclear && !isDefaultSafe(r.license)) return false;
      if (color !== 'all') {
        const c = colors[r.key];
        if (c && c !== color) return false;
      }
      return true;
    });
  }, [results, showUnclear, color, colors, topic]);

  const hiddenCount = results.length - visible.length;
  const libraryCount = visible.filter((r) => r.source === 'library').length;

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

  const anyLoading = SRCS.some((s) => states[s].status === 'loading');
  const anyError = SRCS.some((s) => states[s].status === 'error');

  return (
    <div className="search-layout">
      <section className="search-main">
        <div className="search-label">חיפוש חופשי</div>
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
            placeholder="חיפוש חופשי: איבר, מבנה או מונח, בעברית או באנגלית (למשל: כליה, spleen)"
            aria-label="חיפוש חופשי"
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

        <div className="search-label">או בחרו נושא — יחופשו כל המונחים של הנושא, ומאגר המורים קודם</div>
        <div className="chips">
          {TOPICS.map((t) => (
            <button key={t.label} className="chip" onClick={() => void runTopic(t)} title="מחפש את כל המונחים של הנושא מתוך מסמך המונחים">
              {t.label}
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
            {SRCS.map((s) => (
              <label key={s} className="check">
                <input type="checkbox" checked={enabled[s]} onChange={(e) => setEnabled((m) => ({ ...m, [s]: e.target.checked }))} /> {SRC_LABEL[s]}{s === 'openverse' ? ' (ניסיוני, לעיתים איטי)' : ''}
              </label>
            ))}
            <label className="check"><input type="checkbox" checked={showUnclear} onChange={(e) => setShowUnclear(e.target.checked)} /> הצג גם תמונות עם רישיון לא ברור או מוגבל</label>
            <span className="muted">Servier Medical Art: לא זמין לחיפוש חי בגרסה זו.</span>
          </div>
        )}

        {topic && (
          <div className="translation">
            חיפוש לפי נושא: <strong>{topic.topic.label}</strong> — {topic.terms.length} מונחים מתוך מסמך המונחים. מוצגים {Math.min(topic.loaded, topic.terms.length)} מתוכם.
          </div>
        )}
        {searched && !topic && englishChoices.length > 0 && (
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

        {SRCS.map((src) =>
          states[src].status === 'error' ? (
            <div key={src} className="error-box">
              {states[src].error}{' '}
              {SRCS.some((o) => o !== src && states[o].status === 'ok')
                ? 'שאר המאגרים ממשיכים לעבוד.'
                : 'בדקו את החיבור לאינטרנט ונסו שוב בעוד רגע.'}
            </div>
          ) : null,
        )}

        {searched && !anyLoading && visible.length === 0 && !anyError && (
          <div className="empty">
            לא נמצאו תוצאות מתאימות.
            {hiddenCount > 0 && ' (חלק מהתוצאות הוסתרו בגלל רישיון או מסנן צבע — אפשר להרחיב בהגדרות המתקדמות.)'}
          </div>
        )}
        {!searched && (
          <div className="empty hint">
            התחילו בחיפוש, או לחצו על אחד הנושאים — כל המונחים של הנושא יחופשו. התוצאות מגיעות בזמן אמת ממאגר המורים ומאגרים פתוחים — המורה בוחר מה מתאים מבחינה אנטומית ופדגוגית.
          </div>
        )}

        <div className="grid">
          {visible.map((r, i) => (
            <Fragment key={r.key}>
              {topic && r.topic !== visible[i - 1]?.topic && <h3 className="topic-head">{r.topic}</h3>}
              {!topic && libraryCount > 0 && (i === 0 || (r.source === 'library') !== (visible[i - 1].source === 'library')) && (
                <h3 className="topic-head">{r.source === 'library' ? `מאגר המורים (${libraryCount})` : 'ממאגרים פתוחים'}</h3>
              )}
            <ResultCard
              r={r}
              selected={selectedKeys.has(`${r.source}:${r.sourceId}`)}
              busy={adding.has(r.key)}
              onZoom={() => setZoom(r)}
              onAdd={() => void add(r)}
              onColor={(c) => setColors((m) => (m[r.key] ? m : { ...m, [r.key]: c }))}
            />
            </Fragment>
          ))}
        </div>

        {searched && hiddenCount > 0 && visible.length > 0 && <p className="muted center">{hiddenCount} תוצאות מוסתרות לפי מסנני הרישיון/הצבע.</p>}

        <div className="more">
          {topic && topic.loaded < topic.terms.length && (
            <button className="btn primary" disabled={topic.loading} onClick={() => void moreTopicTerms()}>
              {topic.loading ? 'טוען…' : `עוד מונחים מהנושא (${topic.terms.length - topic.loaded} נותרו)`}
            </button>
          )}
          {SRCS.map(
            (src) =>
              states[src].hasMore && (
                <button key={src} className="btn" disabled={states[src].status === 'loading'} onClick={() => void loadMore(src)}>
                  {states[src].status === 'loading' ? 'טוען…' : `עוד תוצאות מ-${SRC_LABEL[src]}`}
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
          <span className="src">{SRC_SHORT[r.source]}</span>
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
  const big =
    r.source === 'commons'
      ? r.thumbUrl.replace(/\/500px-/, '/1280px-')
      : r.source === 'wellcome'
        ? r.thumbUrl.replace('/full/400,/', '/full/1000,/')
        : r.thumbUrl;
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
            <dd>{SRC_LABEL[r.source]}{r.credit && r.source === 'openverse' ? ` (${r.credit})` : ''}</dd>
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
