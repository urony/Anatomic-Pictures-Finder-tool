import { describe, expect, it } from 'vitest';
import { classifyLicense, safeUrl } from './license';
import { expandQuery, normalizeHebrew, suggest, type TermsFile } from './terms';
import { layoutDocument, type TextMeasurer } from './layout';
import { importFromProject } from './projectIo';
import { DEFAULT_SETTINGS, type ExamImage, type Mark } from '../types';
import terms from '../../public/data/anatomy-terms.json';

const measurer: TextMeasurer = { measure: (t) => t.length * 6 };

function img(id: string, w: number, h: number, nums: number[] = []): ExamImage {
  const marks: Mark[] = nums.map((n) => ({ id: `${id}-${n}`, num: n, tx: 0.5, ty: 0.5, lx: 0.5, ly: 0.5, line: false }));
  return {
    id,
    source: 'commons',
    sourceId: id,
    title: id,
    author: 'x',
    pageUrl: '',
    fileUrl: '',
    license: { name: 'CC BY 4.0', level: 'free', note: '' },
    credit: 'Wikimedia Commons',
    fetchedAt: '',
    notes: [],
    dataUrl: 'data:image/png;base64,AA==',
    width: w,
    height: h,
    marks,
  };
}

describe('license', () => {
  it.each([
    ['CC BY-SA 4.0', 'share'],
    ['CC BY 3.0', 'free'],
    ['CC0', 'free'],
    ['Public domain', 'free'],
    ['Public Domain Mark', 'free'],
    ['CC BY-NC 4.0', 'restricted'],
    ['CC BY-ND 2.0', 'restricted'],
    ['CC BY-NC-SA 3.0', 'restricted'],
    ['', 'unclear'],
    ['Fair use', 'unclear'],
    ['in-copyright', 'unclear'],
  ])('classifies %s as %s', (name, level) => {
    expect(classifyLicense(name).level).toBe(level);
  });
  it('allows only http(s) urls', () => {
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeUrl('https://example.com/a')).toBe('https://example.com/a');
  });
});

describe('terms', () => {
  const file = terms as unknown as TermsFile;
  it('normalizes niqqud and quotes', () => {
    expect(normalizeHebrew('לֵב')).toBe('לב');
  });
  it('maps Hebrew organs to English', () => {
    expect(expandQuery('לב', file).english[0]).toContain('heart');
    expect(expandQuery('הלב', file).english[0]).toContain('heart');
    expect(expandQuery('כליות', file).english[0]).toContain('kidney');
    expect(expandQuery('בלוטת התריס', file).english[0].toLowerCase()).toContain('thyroid');
    expect(expandQuery('מוח', file).english[0]).toContain('brain');
  });
  it('passes English queries through', () => {
    const e = expandQuery('spleen', file);
    expect(e.passthrough).toBe(true);
    expect(e.english).toEqual(['spleen']);
  });
  it('reports no match for unknown Hebrew', () => {
    expect(expandQuery('בלה בלה', file).matched).toBe(false);
  });
  it('suggests by prefix', () => {
    expect(suggest('כל', file).length).toBeGreaterThan(0);
  });
});

describe('layout', () => {
  it('puts one image per page and builds table rows from marks', () => {
    const pages = layoutDocument([img('a', 800, 600, [1, 2, 3]), img('b', 600, 800, [4, 5])], { ...DEFAULT_SETTINGS, perPage: 1 }, measurer);
    expect(pages).toHaveLength(2);
    expect(pages[0].table?.rows.map((r) => r.number)).toEqual(['1', '2', '3']);
    expect(pages[1].table?.rows.map((r) => r.number)).toEqual(['4', '5']);
  });
  it('never distorts images and keeps them inside the page', () => {
    const imgs = [img('a', 1000, 300), img('b', 300, 1000), img('c', 500, 500), img('d', 900, 600), img('e', 400, 700)];
    for (const perPage of [1, 2, 3, 4, 6]) {
      const pages = layoutDocument(imgs, { ...DEFAULT_SETTINGS, perPage }, measurer);
      for (const p of pages) {
        for (const pi of p.images) {
          expect(pi.rect.w / pi.rect.h).toBeCloseTo(pi.image.width / pi.image.height, 3);
          expect(pi.rect.x).toBeGreaterThanOrEqual(0);
          expect(pi.rect.x + pi.rect.w).toBeLessThanOrEqual(p.paperW);
          expect(pi.rect.y + pi.rect.h).toBeLessThanOrEqual(p.paperH);
        }
      }
    }
  });
  it('does not overlap images with the table', () => {
    const pages = layoutDocument([img('a', 800, 1200, [1, 2, 3, 4, 5, 6, 7, 8])], DEFAULT_SETTINGS, measurer);
    const p = pages[0];
    const bottom = Math.max(...p.images.map((i) => i.cell.y + i.cell.h));
    expect(bottom).toBeLessThanOrEqual(p.table!.rect.y);
  });
  it('continues a long table on an extra page', () => {
    const nums = Array.from({ length: 40 }, (_, i) => i + 1);
    const pages = layoutDocument([img('a', 800, 600, nums)], DEFAULT_SETTINGS, measurer);
    expect(pages.length).toBeGreaterThan(1);
    const total = pages.reduce((n, p) => n + (p.table?.rows.length ?? 0), 0);
    expect(total).toBe(40);
    expect(pages[1].table?.continued).toBe(true);
  });
  it('omits the table when disabled', () => {
    const pages = layoutDocument([img('a', 800, 600, [1])], { ...DEFAULT_SETTINGS, showTable: false }, measurer);
    expect(pages[0].table).toBeUndefined();
  });
  it('adds a figure column for restart numbering with several images per page', () => {
    const pages = layoutDocument(
      [img('a', 800, 600, [1, 2]), img('b', 800, 600, [1, 2])],
      { ...DEFAULT_SETTINGS, perPage: 2, numbering: 'restart' },
      measurer,
    );
    expect(pages[0].table?.showFigureCol).toBe(true);
    expect(pages[0].table?.rows).toHaveLength(4);
  });
  it('warns about low resolution', () => {
    const pages = layoutDocument([img('a', 200, 150)], DEFAULT_SETTINGS, measurer);
    expect(pages[0].warnings.join(' ')).toContain('רזולוציה');
  });
});

describe('project file', () => {
  it('rejects non-project json', () => {
    expect(() => importFromProject('{"a":1}')).toThrow();
    expect(() => importFromProject('nope')).toThrow();
  });
  it('round-trips and drops unsafe data URLs', () => {
    const good = img('a', 10, 10, [1]);
    const bad = { ...img('b', 10, 10), dataUrl: 'javascript:alert(1)' };
    const text = JSON.stringify({ format: 'anatomy-exam-builder', version: 1, settings: DEFAULT_SETTINGS, images: [good, bad] });
    const out = importFromProject(text);
    expect(out.images).toHaveLength(1);
    expect(out.images[0].marks[0].num).toBe(1);
  });
});

describe('terms precision', () => {
  const file = terms as unknown as TermsFile;
  it('does not confuse kidney with placenta', () => {
    const e = expandQuery('כליה', file).english.join(' ');
    expect(e).toContain('kidney');
    expect(e).not.toContain('placenta');
  });
  it('handles the definite article', () => {
    expect(expandQuery('הלב', file).english[0]).toContain('heart');
    expect(expandQuery('הכבד', file).english[0]).toContain('liver');
  });
});

describe('glossary-derived terms', () => {
  const file = terms as unknown as TermsFile;
  it.each([
    ['חדר', 'ventricle'],
    ['אבי העורקים', 'aorta'],
    ['נימים', 'capillary'],
    ['פקעית הנפרון', 'glomerulus'],
    ['לולאת הנלה', 'henle'],
    ['בלוטת התימוס', 'thymus'],
    ['איי לנגרהנס', 'langerhans'],
    ['הלבלב', 'pancreas'],
    ['רירית הרחם', 'endometrium'],
    ['צינור מוביל הזרע', 'deferens'],
    ['קוצב הסינוס', 'sinus'],
    ['טחול', 'spleen'],
  ])('finds %s', (q, expected) => {
    expect(expandQuery(q, file).english.join(' ').toLowerCase()).toContain(expected);
  });
  it('keeps every glossary term searchable by its first Hebrew name', () => {
    const bad = file.terms.filter((t) => /[0590-05FF]/.test(t.he[0])).filter((t) => !expandQuery(t.he[0], file).matched).map((t) => t.he[0]);
    expect(bad).toEqual([]);
  });
});

describe('answer table', () => {
  it('pick mode makes N empty rows and a four-column header', () => {
    const [p] = layoutDocument([img('a', 800, 600, [1, 2, 3, 4, 5, 6])], { ...DEFAULT_SETTINGS, tableMode: 'pick', pickCount: 4 }, measurer);
    expect(p.table?.rows).toHaveLength(4);
    expect(p.table?.rows.every((r) => r.number === '')).toBe(true);
    expect(p.table?.columns.map((c) => c.key)).toEqual(['num', 'he', 'en', 'fn']);
  });
  it('can hide optional columns', () => {
    const [p] = layoutDocument([img('a', 800, 600, [1])], { ...DEFAULT_SETTINGS, tableCols: { en: false, fn: false } }, measurer);
    expect(p.table?.columns.map((c) => c.key)).toEqual(['num', 'he']);
  });
  it('keeps a 4-row table at about a quarter of the page or less', () => {
    const [p] = layoutDocument([img('a', 800, 600, [1, 2, 3, 4])], DEFAULT_SETTINGS, measurer);
    const t = p.table!;
    const total = t.rect.h + t.instrLines.length * 16;
    expect(total / p.paperH).toBeLessThan(0.3);
    expect(t.rect.y + t.rect.h).toBeLessThanOrEqual(p.paperH);
  });
  it('column widths add up to the content width', () => {
    const [p] = layoutDocument([img('a', 800, 600, [1])], DEFAULT_SETTINGS, measurer);
    expect(p.table!.columns.reduce((n, c) => n + c.w, 0)).toBeCloseTo(p.table!.rect.w, 3);
  });
});

import { scoreItem, tokenize, toResult, type LibraryItem } from '../sources/library';
import { TOPICS, termsForTopic } from './topics';

describe('library matching', () => {
  const item = (file: string, keywords: string[]): LibraryItem => ({ file, title: file, keywords });
  it('tokenizes file-style names', () => {
    expect(tokenize('kidney_nephron-02.png')).toEqual(['kidney', 'nephron', 'png']);
  });
  it('matches plurals and prefixes, ignores generic words', () => {
    const k = item('kidney_nephron.png', ['kidney', 'nephron']);
    expect(scoreItem(k, tokenize('kidneys'))).toBe(1);
    expect(scoreItem(k, tokenize('kidney anatomy'))).toBe(1);
    expect(scoreItem(k, tokenize('heart'))).toBe(0);
    expect(scoreItem(k, tokenize('nephron kidney'))).toBe(2);
  });
  it('library items without license are marked as team uploads and shown by default', () => {
    const r = toResult(item('a/b c.png', ['b']));
    expect(r.license.level).toBe('user');
    expect(r.fullUrl).toContain('library/a/b%20c.png');
  });
  it('uses a real license when the credit sheet provides one', () => {
    const r = toResult({ ...item('x.png', ['x']), license: 'CC BY 4.0', author: 'Jane' });
    expect(r.license.level).toBe('free');
    expect(r.author).toBe('Jane');
  });
});

describe('topics', () => {
  const file = terms as unknown as TermsFile;
  it('female reproductive topic collects glossary terms with the lead first', () => {
    const t = TOPICS.find((x) => x.label === 'מערכת הרבייה הנקבית')!;
    const list = termsForTopic(t, file).map((x) => x.en.toLowerCase());
    expect(list[0]).toBe('female reproductive system');
    for (const w of ['vagina', 'uterus', 'endometrium', 'ovulation']) expect(list.some((e) => e.includes(w))).toBe(true);
  });
  it('every topic has several terms and no duplicates', () => {
    for (const t of TOPICS) {
      const list = termsForTopic(t, file).map((x) => x.en.toLowerCase());
      expect(list.length, t.label).toBeGreaterThanOrEqual(2);
      expect(new Set(list).size, t.label).toBe(list.length);
    }
  });
  it('thyroid topic excludes parathyroid terms', () => {
    const t = TOPICS.find((x) => x.label === 'בלוטת התריס')!;
    const list = termsForTopic(t, file).map((x) => x.en.toLowerCase()).join(' | ');
    expect(list).toContain('calcitonin');
    expect(list).not.toContain('chief cells');
  });
});

import { plainTerm } from '../sources/commons';
describe('plainTerm', () => {
  it('keeps words intact and drops generic suffixes', () => {
    expect(plainTerm('heart anatomy')).toBe('heart');
    expect(plainTerm('Adrenal glands')).toBe('Adrenal glands');
    expect(plainTerm('Loop of Henle')).toBe('Loop of Henle');
    expect(plainTerm('anatomy')).toBe('anatomy');
  });
});

import { medianColor } from './render';
describe('covers', () => {
  it('median color ignores outliers such as text pixels', () => {
    const bg: [number, number, number][] = Array.from({ length: 20 }, () => [240, 230, 210]);
    expect(medianColor([...bg, [0, 0, 0], [10, 10, 10]])).toBe('#f0e6d2');
    expect(medianColor([])).toBe('#ffffff');
  });
  it('project import keeps valid covers and sanitizes bad ones', () => {
    const im = { ...img('a', 10, 10), covers: [{ id: 'c1', x: 0.1, y: 0.2, w: 0.3, h: 0.1, color: '#aabbcc' }, { id: 'c2', x: 5, y: -1, w: 0.2, h: 0.2, color: 'url(evil)' }] };
    const out = importFromProject(JSON.stringify({ format: 'anatomy-exam-builder', version: 1, settings: DEFAULT_SETTINGS, images: [im] }));
    const c = out.images[0].covers!;
    expect(c[0].color).toBe('#aabbcc');
    expect(c[1].x).toBe(1);
    expect(c[1].y).toBe(0);
    expect(c[1].color).toBe('#ffffff');
  });
});

import { withEnglishKeywords } from '../sources/library';
describe('Hebrew file names in the library', () => {
  const file = terms as unknown as TermsFile;
  it('match Hebrew queries, with or without the definite article', () => {
    const it = { file: 'שחלה_זקיק.jpg', title: 'שחלה זקיק', keywords: tokenize('שחלה_זקיק') };
    expect(scoreItem(it, tokenize('שחלה'))).toBeGreaterThan(0);
    expect(scoreItem(it, tokenize('השחלה'))).toBeGreaterThan(0);
    expect(scoreItem(it, tokenize('כליה'))).toBe(0);
  });
  it('also match English searches through the dictionary', () => {
    const it = withEnglishKeywords({ file: 'רחם.png', title: 'רחם', keywords: ['רחם'] }, file);
    expect(scoreItem(it, tokenize('uterus'))).toBeGreaterThan(0);
    const kidney = withEnglishKeywords({ file: 'כליה.png', title: 'כליה', keywords: ['כליה'] }, file);
    expect(scoreItem(kidney, tokenize('kidney'))).toBeGreaterThan(0);
  });
  it('percent-encodes Hebrew paths for the URL', () => {
    const r = toResult({ file: 'שחלה.jpg', title: 'שחלה', keywords: ['שחלה'] });
    expect(r.fullUrl).toContain(encodeURIComponent('שחלה.jpg'));
  });
});

import { bwLut } from './render';
describe('black & white conversion', () => {
  const hist = (vals: number[]) => {
    const h = new Uint32Array(256);
    vals.forEach((v) => h[v]++);
    return h;
  };
  it('gray mode leaves levels unchanged', () => {
    const lut = bwLut(hist([10, 200]), 2, 'gray', 50);
    expect(lut[10]).toBe(10);
    expect(lut[200]).toBe(200);
  });
  it('contrast mode is monotonic and pushes darks darker / lights lighter', () => {
    const vals = Array.from({ length: 100 }, (_, i) => 60 + i); // תמונה "דהויה": 60..159
    const lut = bwLut(hist(vals), vals.length, 'contrast', 60);
    for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
    expect(lut[65]).toBeLessThan(65);
    expect(lut[155]).toBeGreaterThan(155);
    expect(lut[255]).toBe(255);
  });
  it('stronger setting increases contrast', () => {
    const vals = Array.from({ length: 100 }, (_, i) => 40 + i * 2);
    const weak = bwLut(hist(vals), 100, 'contrast', 10);
    const strong = bwLut(hist(vals), 100, 'contrast', 100);
    expect(strong[60]).toBeLessThanOrEqual(weak[60]);
    expect(strong[200]).toBeGreaterThanOrEqual(weak[200]);
  });
});

import { stem } from '../sources/library';
describe('library topic matching (regression: Ovary_1.jpg missing under female system)', () => {
  const file = terms as unknown as TermsFile;
  const ovary: LibraryItem = { file: 'Ovary_1.jpg', title: 'Ovary 1', keywords: ['ovary'] };
  it('stems plurals to the same form', () => {
    expect(stem('Ovaries')).toBe(stem('ovary'));
    expect(stem('kidneys')).toBe(stem('kidney'));
    expect(stem('glands')).toBe(stem('gland'));
    expect(stem('שחלות')).toBe(stem('שחלה'));
  });
  it('the glossary terms alone already find the ovary picture under the female system', () => {
    const f = TOPICS.find((x) => x.label === 'מערכת הרבייה הנקבית')!;
    expect(scoreItem(ovary, termsForTopic(f, file).flatMap((x) => tokenize(x.en)))).toBeGreaterThan(0);
  });
  it('every topic shows library images with a related keyword', () => {
    const cases: [string, string][] = [
      ['מערכת הרבייה הנקבית', 'ovary'],
      ['מערכת הרבייה הנקבית', 'uterus'],
      ['מערכת הרבייה הזכרית', 'testis'],
      ['מערכת אנדוקרינית', 'adrenal'],
      ['מערכת אנדוקרינית', 'pancreas'],
      ['לבלב', 'islets'],
      ['לב', 'ventricle'],
      ['כליה', 'nephron'],
    ];
    for (const [label, kw] of cases) {
      const t = TOPICS.find((x) => x.label === label)!;
      const phrases = [...termsForTopic(t, file).flatMap((x) => [x.en, x.he]), ...(t.libraryKeywords ?? []), t.label];
      const item: LibraryItem = { file: kw + '_x.jpg', title: kw, keywords: [kw] };
      expect(scoreItem(item, phrases.flatMap(tokenize)), label + ' / ' + kw).toBeGreaterThan(0);
    }
  });
  it('does not match unrelated topics', () => {
    const t = TOPICS.find((x) => x.label === 'לב')!;
    const phrases = [...termsForTopic(t, file).flatMap((x) => [x.en, x.he]), ...(t.libraryKeywords ?? [])];
    expect(scoreItem(ovary, phrases.flatMap(tokenize))).toBe(0);
  });
});
