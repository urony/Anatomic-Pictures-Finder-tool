import type { ExamImage, Mark, MarkSize, Settings } from '../types';

/** כל המידות בנקודות (pt), 72 לאינץ' */
export const PAPERS = {
  A4: { w: 595.28, h: 841.89 },
  Letter: { w: 612, h: 792 },
} as const;

export const MARGIN = 38;
export const HEADER_FONT = 'Arial, "Segoe UI", "Noto Sans Hebrew", sans-serif';

export const MARK_RADIUS: Record<MarkSize, number> = { small: 7, medium: 9.5, large: 12 };

export function figureLetter(i: number): string {
  const letters = 'אבגדהוזחטיכלמנסעפצקרשת';
  return letters[i] ?? String(i + 1);
}

export interface TextMeasurer {
  measure(text: string, font: string): number;
}

export function canvasMeasurer(): TextMeasurer {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const ctx = c?.getContext('2d') ?? null;
  return {
    measure(text, font) {
      if (!ctx) return text.length * 5;
      ctx.font = font;
      return ctx.measureText(text).width;
    },
  };
}

/** שבירת שורות לפי רוחב; מפצל גם "מילים" ארוכות (כמו כתובות) */
export function wrapText(text: string, maxW: number, font: string, m: TextMeasurer): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    const flush = () => {
      if (line) out.push(line);
      line = '';
    };
    for (let w of words) {
      while (m.measure(w, font) > maxW && w.length > 1) {
        // מפרקים מילה ארוכה
        let cut = w.length - 1;
        while (cut > 1 && m.measure(w.slice(0, cut), font) > maxW) cut--;
        flush();
        out.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      const test = line ? `${line} ${w}` : w;
      if (m.measure(test, font) <= maxW) line = test;
      else {
        flush();
        line = w;
      }
    }
    flush();
  }
  return out;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedImage {
  image: ExamImage;
  /** מספר האיור בקרב כל התמונות במסמך (0..) */
  index: number;
  /** התא בעמוד, כולל מקום לכיתוב */
  cell: Rect;
  /** המלבן שבו התמונה מצוירת בפועל */
  rect: Rect;
  caption?: string;
  /** רזולוציית הדפסה אפקטיבית (dpi) */
  dpi: number;
}

export interface TableRow {
  figure?: string;
  number: string;
}

export interface TableColumn {
  key: 'fig' | 'num' | 'he' | 'en' | 'fn';
  label: string;
  /** רוחב בנקודות */
  w: number;
  lines: string[];
}

export interface TableLayout {
  /** הטבלה עצמה (כותרת + שורות), בלי שורות ההנחיה שמעליה */
  rect: Rect;
  instrLines: string[];
  headerH: number;
  rowH: number;
  rows: TableRow[];
  columns: TableColumn[];
  showFigureCol: boolean;
  /** האם זו המשכה של טבלה מעמוד קודם */
  continued: boolean;
}

const COL_LABEL: Record<TableColumn['key'], string> = {
  fig: 'איור',
  num: 'מספר החלק/החומר באיור',
  he: 'שם החלק/החומר בעברית',
  en: 'שם החלק/החומר באנגלית',
  fn: 'אחד מתפקידי החלק/החומר',
};
const COL_WEIGHT: Record<TableColumn['key'], number> = { fig: 0.09, num: 0.15, he: 0.25, en: 0.25, fn: 0.36 };

/** בונה את עמודות הטבלה (מימין לשמאל) עם רוחבים ושורות כותרת */
export function buildColumns(s: Settings, showFig: boolean, totalW: number, m: TextMeasurer): { cols: TableColumn[]; headerH: number } {
  const keys: TableColumn['key'][] = [];
  if (showFig) keys.push('fig');
  keys.push('num', 'he');
  if (s.tableCols.en) keys.push('en');
  if (s.tableCols.fn) keys.push('fn');
  const sum = keys.reduce((n, k) => n + COL_WEIGHT[k], 0);
  const cols = keys.map((k) => {
    const w = (COL_WEIGHT[k] / sum) * totalW;
    return { key: k, label: COL_LABEL[k], w, lines: wrapText(COL_LABEL[k], w - 10, FONT.table, m) };
  });
  const maxLines = Math.max(...cols.map((c) => c.lines.length));
  return { cols, headerH: Math.max(26, maxLines * 15 + 10) };
}

export interface PageLayout {
  paperW: number;
  paperH: number;
  pageNo: number;
  pageCount: number;
  title?: string;
  titleLines: string[];
  instructionLines: string[];
  headerBottom: number;
  images: PlacedImage[];
  table?: TableLayout;
  creditLines: string[];
  creditsTop: number;
  warnings: string[];
}

export const FONT = {
  title: `bold 17px ${HEADER_FONT}`,
  body: `12px ${HEADER_FONT}`,
  caption: `bold 11px ${HEADER_FONT}`,
  credit: `7.5px ${HEADER_FONT}`,
  table: `12px ${HEADER_FONT}`,
  tableHead: `bold 12px ${HEADER_FONT}`,
};

export function paperSize(s: Settings): { w: number; h: number } {
  const p = PAPERS[s.paper];
  return s.landscape ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

function creditFor(img: ExamImage, index: number): string {
  const parts: string[] = [];
  parts.push(`איור ${figureLetter(index)}: ${img.title}`);
  if (img.author && img.source !== 'upload') parts.push(img.author);
  parts.push(img.source === 'upload' ? 'תמונה שהועלתה על ידי המורה' : img.credit);
  if (img.source !== 'upload') {
    parts.push(img.license.name + (img.license.url ? ` (${img.license.url})` : ''));
    if (img.pageUrl) parts.push(img.pageUrl);
    if (img.marks.length) parts.push('נוספו סימונים');
  }
  return parts.join(' | ');
}

/** מספר השורות המוצגות בטבלה: כל המספרים של התמונות שבעמוד + שורות נוספות */
export function tableRowsFor(images: { image: ExamImage; index: number }[], s: Settings): TableRow[] {
  if (s.tableMode === 'pick') {
    return images.length ? Array.from({ length: Math.max(1, s.pickCount) }, () => ({ number: '' })) : [];
  }
  const showFig = s.numbering === 'restart' && images.length > 1;
  const rows: TableRow[] = [];
  for (const { image, index } of images) {
    const sorted = [...image.marks].sort((a, b) => a.num - b.num);
    for (const m of sorted) rows.push({ number: String(m.num), figure: showFig ? figureLetter(index) : undefined });
  }
  if (s.numbering === 'continuous') rows.sort((a, b) => Number(a.number) - Number(b.number));
  if (rows.length || s.extraRows) for (let i = 0; i < s.extraRows; i++) rows.push({ number: '', figure: undefined });
  return rows;
}

/** בוחר את חלוקת הרשת (עמודות x שורות) שנותנת לתמונות הכי הרבה שטח */
function bestGrid(imgs: ExamImage[], zone: Rect, captionH: number, gap: number): { cols: number; rows: number } {
  const n = imgs.length;
  let best = { cols: 1, rows: n, score: -1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (zone.w - gap * (cols - 1)) / cols;
    const ch = (zone.h - gap * (rows - 1)) / rows - captionH;
    if (cw <= 20 || ch <= 20) continue;
    let minArea = Infinity;
    for (const im of imgs) {
      const sc = Math.min(cw / im.width, ch / im.height);
      minArea = Math.min(minArea, im.width * sc * im.height * sc);
    }
    if (minArea > best.score) best = { cols, rows, score: minArea };
  }
  return best.score < 0 ? { cols: 1, rows: n } : { cols: best.cols, rows: best.rows };
}

export function fitInto(w: number, h: number, box: Rect): Rect {
  const sc = Math.min(box.w / w, box.h / h);
  const rw = w * sc;
  const rh = h * sc;
  return { x: box.x + (box.w - rw) / 2, y: box.y + (box.h - rh) / 2, w: rw, h: rh };
}

const GAP = 12;
export const MIN_ROW_H = 20;
export const MAX_ROW_H = 30;
const MAX_TABLE_GROWTH = 0.45;

/**
 * מחשב את כל העמודים. אותו חישוב משמש לתצוגה מקדימה, PDF, DOCX ו-PNG,
 * כך שמה שהמורה רואה הוא מה שיוצא.
 */
export function layoutDocument(images: ExamImage[], s: Settings, m: TextMeasurer = canvasMeasurer()): PageLayout[] {
  const { w: paperW, h: paperH } = paperSize(s);
  const innerW = paperW - MARGIN * 2;
  const pages: PageLayout[] = [];
  const perPage = Math.max(1, s.perPage);

  const chunks: { image: ExamImage; index: number }[][] = [];
  for (let i = 0; i < images.length; i += perPage) {
    chunks.push(images.slice(i, i + perPage).map((image, k) => ({ image, index: i + k })));
  }
  if (chunks.length === 0) chunks.push([]);

  chunks.forEach((chunk, ci) => {
    const first = ci === 0;
    const titleLines = first && s.title ? wrapText(s.title, innerW, FONT.title, m) : [];
    const instructionLines = first && s.instructions ? wrapText(s.instructions, innerW, FONT.body, m) : [];
    let y = MARGIN;
    y += titleLines.length * 24;
    if (titleLines.length) y += 4;
    y += instructionLines.length * 17;
    if (instructionLines.length) y += 6;
    const headerBottom = y;

    const creditLines: string[] = [];
    if (s.showCredits && chunk.length) {
      for (const { image, index } of chunk) creditLines.push(...wrapText(creditFor(image, index), innerW, FONT.credit, m));
    }
    const creditH = creditLines.length * 9.5 + (creditLines.length ? 6 : 0);
    const creditsTop = paperH - MARGIN - creditH;
    const bodyTop = headerBottom + 4;
    const bodyBottom = creditsTop - (creditLines.length ? 4 : 0);
    const bodyH = bodyBottom - bodyTop;

    const warnings: string[] = [];
    const rows = s.showTable ? tableRowsFor(chunk, s) : [];

    let imageZoneH = bodyH;
    let table: TableLayout | undefined;
    let overflowRows: TableRow[] = [];
    if (s.showTable && rows.length > 0) {
      const showFig = rows.some((r) => r.figure);
      const { cols, headerH } = buildColumns(s, showFig, innerW, m);
      const instrLines = s.tableInstructions.trim() ? wrapText(s.tableInstructions.trim(), innerW, FONT.body, m) : [];
      const instrH = instrLines.length ? instrLines.length * 16 + 6 : 0;
      // החלק שהוקצה לטבלה הוא תקרה; אם יש הרבה שורות מאפשרים גידול עד 45% לפני שמפצלים לעמוד נוסף
      const needed = instrH + headerH + rows.length * MIN_ROW_H;
      const zoneH = Math.min(bodyH * MAX_TABLE_GROWTH, Math.max(bodyH * s.tableRatio, needed));
      const capacity = Math.max(1, Math.floor((zoneH - instrH - headerH) / MIN_ROW_H));
      const used = rows.slice(0, capacity);
      overflowRows = rows.slice(capacity);
      const rowH = Math.min(MAX_ROW_H, (zoneH - instrH - headerH) / used.length);
      const gridH = headerH + rowH * used.length;
      const total = instrH + gridH;
      imageZoneH = bodyH - total - GAP;
      table = {
        rect: { x: MARGIN, y: bodyBottom - total + instrH, w: innerW, h: gridH },
        instrLines,
        headerH,
        rowH,
        rows: used,
        columns: cols,
        showFigureCol: showFig,
        continued: false,
      };
      if (overflowRows.length) warnings.push('הטבלה ארוכה מהמקום שהוקצה — היא תמשיך בעמוד נוסף.');
    }

    const zone: Rect = { x: MARGIN, y: bodyTop, w: innerW, h: imageZoneH };
    const captionH = s.showCaptions && (chunk.length > 1 || s.showCredits) ? 16 : 0;
    const placed: PlacedImage[] = [];
    if (chunk.length) {
      const imgs = chunk.map((c) => c.image);
      const { cols, rows: gridRows } = bestGrid(imgs, zone, captionH, GAP);
      const cw = (zone.w - GAP * (cols - 1)) / cols;
      const ch = (zone.h - GAP * (gridRows - 1)) / gridRows;
      chunk.forEach(({ image, index }, k) => {
        const r = Math.floor(k / cols);
        const c = k % cols;
        const inRow = Math.min(cols, chunk.length - r * cols);
        // שורה אחרונה לא מלאה — ממורכזת. כיוון RTL: התא הראשון בימין
        const rowW = inRow * cw + (inRow - 1) * GAP;
        const startX = zone.x + (zone.w - rowW) / 2;
        const x = startX + (rowW - cw) - c * (cw + GAP);
        const cell: Rect = { x, y: zone.y + r * (ch + GAP), w: cw, h: ch };
        const rect = fitInto(image.width, image.height, { x: cell.x, y: cell.y, w: cell.w, h: cell.h - captionH });
        const dpi = image.width / (rect.w / 72);
        placed.push({
          image,
          index,
          cell,
          rect,
          caption: captionH ? `איור ${figureLetter(index)}` : undefined,
          dpi,
        });
        if (dpi < 90) warnings.push(`איור ${figureLetter(index)}: רזולוציה נמוכה להדפסה (~${Math.round(dpi)} dpi).`);
        const minDist = minMarkDistancePt(image.marks, rect);
        const r0 = MARK_RADIUS[s.markSize];
        if (minDist !== null && minDist < r0 * 1.7) warnings.push(`איור ${figureLetter(index)}: מספרים צפופים/חופפים — הגדילו את התמונה או הזיזו מספר.`);
      });
      if (rect_too_small(placed)) warnings.push('העמוד צפוף — כדאי להקטין את מספר התמונות בעמוד.');
    }

    pages.push({
      paperW,
      paperH,
      pageNo: 0,
      pageCount: 0,
      title: first ? s.title : undefined,
      titleLines,
      instructionLines,
      headerBottom,
      images: placed,
      table,
      creditLines,
      creditsTop,
      warnings: [...new Set(warnings)],
    });

    // המשך טבלה בעמודים נוספים
    let rest = overflowRows;
    while (rest.length) {
      const top = MARGIN + 28;
      const avail = paperH - MARGIN - top;
      const showFig = rest.some((r) => r.figure);
      const { cols, headerH } = buildColumns(s, showFig, innerW, m);
      const cap = Math.max(1, Math.floor((avail - headerH) / MAX_ROW_H));
      const used = rest.slice(0, cap);
      rest = rest.slice(cap);
      pages.push({
        paperW,
        paperH,
        pageNo: 0,
        pageCount: 0,
        title: 'המשך טבלת התשובות',
        titleLines: ['המשך טבלת התשובות'],
        instructionLines: [],
        headerBottom: top,
        images: [],
        table: {
          rect: { x: MARGIN, y: top, w: innerW, h: headerH + used.length * MAX_ROW_H },
          instrLines: [],
          headerH,
          rowH: MAX_ROW_H,
          rows: used,
          columns: cols,
          showFigureCol: showFig,
          continued: true,
        },
        creditLines: [],
        creditsTop: paperH - MARGIN,
        warnings: [],
      });
    }
  });

  pages.forEach((p, i) => {
    p.pageNo = i + 1;
    p.pageCount = pages.length;
  });
  return pages;
}

function rect_too_small(placed: PlacedImage[]): boolean {
  return placed.some((p) => p.rect.w < 110 || p.rect.h < 90);
}

/** המרחק הקטן ביותר (ב-pt) בין שני מספרים על אותה תמונה */
export function minMarkDistancePt(marks: Mark[], rect: Rect): number | null {
  if (marks.length < 2) return null;
  let min = Infinity;
  for (let i = 0; i < marks.length; i++) {
    for (let j = i + 1; j < marks.length; j++) {
      const dx = (marks[i].lx - marks[j].lx) * rect.w;
      const dy = (marks[i].ly - marks[j].ly) * rect.h;
      min = Math.min(min, Math.hypot(dx, dy));
    }
  }
  return min;
}
