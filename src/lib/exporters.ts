import { PDFDocument } from 'pdf-lib';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  PageOrientation,
  HeightRule,
} from 'docx';
import type { ExamImage, Project, Settings } from '../types';
import { figureLetter, layoutDocument, MARGIN, type PageLayout } from './layout';
import { bwOf, canvasToBlob, loadElements, renderMarkedImage, renderPage } from './render';
import { importFromProject } from './projectIo';

export const EXPORT_SCALE = 3; // ~216 dpi

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function safeFilename(title: string, ext: string): string {
  const base = (title || 'מבחן אנטומיה').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'exam';
  return `${base}.${ext}`;
}

const yieldUi = () => new Promise<void>((r) => setTimeout(r, 0));

export type Progress = (done: number, total: number) => void;

/* ------------------------------ PDF ------------------------------ */

export async function exportPdf(images: ExamImage[], s: Settings, progress?: Progress): Promise<Blob> {
  const layouts = layoutDocument(images, s);
  const els = await loadElements(images);
  const pdf = await PDFDocument.create();
  pdf.setTitle(s.title || 'מבחן אנטומיה');
  pdf.setCreator('Anatomy Exam Builder');
  pdf.setProducer('Anatomy Exam Builder');
  for (let i = 0; i < layouts.length; i++) {
    const L = layouts[i];
    const canvas = renderPage(L, els, { scale: EXPORT_SCALE, markSize: s.markSize, bw: bwOf(s) });
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.95);
    const jpg = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const page = pdf.addPage([L.paperW, L.paperH]);
    page.drawImage(jpg, { x: 0, y: 0, width: L.paperW, height: L.paperH });
    progress?.(i + 1, layouts.length);
    await yieldUi();
  }
  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

/* ------------------------------ PNG ------------------------------ */

export async function exportPagePng(images: ExamImage[], s: Settings, pageIndex: number, type: 'image/png' | 'image/jpeg'): Promise<Blob> {
  const layouts = layoutDocument(images, s);
  const els = await loadElements(images);
  const L = layouts[Math.min(pageIndex, layouts.length - 1)];
  return canvasToBlob(renderPage(L, els, { scale: EXPORT_SCALE, markSize: s.markSize, bw: bwOf(s) }), type, 0.95);
}

export async function exportMarkedImage(image: ExamImage, s: Settings, withMarks: boolean, type: 'image/png' | 'image/jpeg'): Promise<Blob> {
  const els = await loadElements([image]);
  const el = els.get(image.id)!;
  const forExport = withMarks ? image : { ...image, marks: [] };
  return canvasToBlob(renderMarkedImage(forExport, el, s.markSize, 420, 2400, bwOf(s)), type, 0.95);
}

/* ------------------------------ Print ------------------------------ */

export async function printDocument(images: ExamImage[], s: Settings): Promise<void> {
  const layouts = layoutDocument(images, s);
  const els = await loadElements(images);
  const urls: string[] = [];
  for (const L of layouts) {
    const c = renderPage(L, els, { scale: 2.4, markSize: s.markSize, bw: bwOf(s) });
    urls.push(URL.createObjectURL(await canvasToBlob(c, 'image/jpeg', 0.92)));
  }
  const L0 = layouts[0];
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:-9999px;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: ${L0.paperW}pt ${L0.paperH}pt; margin: 0 }
      html,body { margin:0; padding:0 }
      img { display:block; width:${L0.paperW}pt; height:${L0.paperH}pt; page-break-after: always; break-after: page }
      img:last-child { page-break-after: auto; break-after: auto }
    </style></head><body>${urls.map((u) => `<img src="${u}">`).join('')}</body></html>`,
  );
  doc.close();
  await new Promise<void>((resolve) => {
    const imgs = Array.from(doc.images);
    let left = imgs.length;
    if (!left) return resolve();
    imgs.forEach((im) => {
      if (im.complete) {
        if (--left === 0) resolve();
      } else {
        im.onload = im.onerror = () => {
          if (--left === 0) resolve();
        };
      }
    });
  });
  iframe.contentWindow!.focus();
  iframe.contentWindow!.print();
  setTimeout(() => {
    iframe.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
  }, 120000);
}

/* ------------------------------ DOCX ------------------------------ */

const PT_TO_TWIP = 20;
const PT_TO_PX = 96 / 72;

function rtlPara(text: string, opts: { bold?: boolean; size?: number; center?: boolean; color?: string; after?: number } = {}): Paragraph {
  return new Paragraph({
    bidirectional: true,
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.START,
    spacing: { after: opts.after ?? 80 },
    children: [
      new TextRun({ text, bold: opts.bold, size: Math.round((opts.size ?? 11) * 2), rightToLeft: true, color: opts.color, font: 'Arial' }),
    ],
  });
}

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };
const LINE = { style: BorderStyle.SINGLE, size: 6, color: '222222' };
const LINES = { top: LINE, bottom: LINE, left: LINE, right: LINE };

export async function exportDocx(images: ExamImage[], s: Settings, progress?: Progress): Promise<Blob> {
  const layouts = layoutDocument(images, s);
  const els = await loadElements(images);
  const children: (Paragraph | Table)[] = [];
  const innerWpt = layouts[0].paperW - MARGIN * 2;

  for (let pi = 0; pi < layouts.length; pi++) {
    const L = layouts[pi];
    const pageBreak = pi > 0;
    let firstPara = true;
    const mk = (p: Paragraph) => p;
    if (L.titleLines.length) {
      children.push(
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.CENTER,
          pageBreakBefore: pageBreak && firstPara,
          spacing: { after: 120 },
          children: [new TextRun({ text: L.title ?? '', bold: true, size: 34, rightToLeft: true, font: 'Arial' })],
        }),
      );
      firstPara = false;
    }
    if (L.instructionLines.length && pi === 0 && s.instructions) {
      children.push(mk(rtlPara(s.instructions, { size: 11, after: 160 })));
      firstPara = false;
    }
    if (pageBreak && firstPara) {
      children.push(new Paragraph({ pageBreakBefore: true, children: [] }));
    }

    // תמונות: טבלת רשת ללא מסגרת, כל תמונה משוטחת עם הסימונים שלה
    if (L.images.length) {
      const cells = L.images.map((p) => {
        const el = els.get(p.image.id)!;
        const wPt = p.rect.w;
        const hPt = p.rect.h;
        const canvas = renderMarkedImage(p.image, el, s.markSize, wPt, 1500, bwOf(s));
        return { p, canvas, wPt, hPt };
      });
      const blobs = await Promise.all(cells.map((c) => canvasToBlob(c.canvas, 'image/jpeg', 0.9)));
      const datas = await Promise.all(blobs.map((b) => b.arrayBuffer()));
      // מקבצים לשורות לפי ה-y של התא
      const rowsMap = new Map<number, number[]>();
      cells.forEach((c, i) => {
        const key = Math.round(c.p.cell.y);
        rowsMap.set(key, [...(rowsMap.get(key) ?? []), i]);
      });
      const rowKeys = [...rowsMap.keys()].sort((a, b) => a - b);
      const colsN = Math.max(...rowKeys.map((k) => rowsMap.get(k)!.length));
      const colW = Math.floor((innerWpt * PT_TO_TWIP) / colsN);
      const trs = rowKeys.map((k) => {
        const idxs = rowsMap.get(k)!.sort((a, b) => cells[b].p.cell.x - cells[a].p.cell.x); // ימין לשמאל
        const tcs = idxs.map((i) => {
          const c = cells[i];
          const paras: Paragraph[] = [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new ImageRun({
                  type: 'jpg',
                  data: new Uint8Array(datas[i]),
                  transformation: { width: Math.round(c.wPt * PT_TO_PX), height: Math.round(c.hPt * PT_TO_PX) },
                  altText: { title: c.p.image.title, description: c.p.image.title, name: c.p.image.title },
                }),
              ],
            }),
          ];
          if (c.p.caption) paras.push(rtlPara(c.p.caption, { bold: true, size: 10, center: true, after: 0 }));
          return new TableCell({
            width: { size: colW, type: WidthType.DXA },
            borders: NO_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            children: paras,
          });
        });
        return new TableRow({ cantSplit: true, children: tcs });
      });
      children.push(
        new Table({
          visuallyRightToLeft: true,
          width: { size: colW * colsN, type: WidthType.DXA },
          columnWidths: Array(colsN).fill(colW),
          borders: { ...NO_BORDERS, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
          rows: trs,
        }),
      );
    }

    // טבלת תשובות עריכה
    if (L.table) {
      const t = L.table;
      const total = Math.floor(innerWpt * PT_TO_TWIP);
      const widths = t.columns.map((c) => Math.round((c.w / innerWpt) * total));
      widths[widths.length - 1] += total - widths.reduce((n, x) => n + x, 0);
      const rowHeight = Math.max(Math.round(t.rowH * PT_TO_TWIP), 460);
      const cell = (txt: string, w: number, head: boolean) =>
        new TableCell({
          width: { size: w, type: WidthType.DXA },
          borders: LINES,
          shading: head ? { fill: 'E8EEF8' } : undefined,
          verticalAlign: VerticalAlign.CENTER,
          children: [rtlPara(txt, { size: 11, center: true, after: 0 })],
        });
      children.push(new Paragraph({ spacing: { before: 160, after: 40 }, children: [] }));
      if (t.instrLines.length && s.tableInstructions.trim()) children.push(rtlPara(s.tableInstructions.trim(), { size: 11, after: 100 }));
      const header = new TableRow({
        tableHeader: true,
        children: t.columns.map((c, i) => cell(c.label, widths[i], true)),
      });
      const rows = t.rows.map(
        (r) =>
          new TableRow({
            cantSplit: true,
            height: { value: rowHeight, rule: HeightRule.ATLEAST },
            children: t.columns.map((c, i) => cell(c.key === 'num' ? r.number : c.key === 'fig' ? r.figure ?? '' : '', widths[i], false)),
          }),
      );
      children.push(
        new Table({
          visuallyRightToLeft: true,
          width: { size: total, type: WidthType.DXA },
          columnWidths: widths,
          rows: [header, ...rows],
        }),
      );
    }

    if (L.creditLines.length) {
      const creditTexts = imagesCredits(L);
      children.push(new Paragraph({ spacing: { before: 160 }, children: [] }));
      for (const c of creditTexts) children.push(rtlPara(c, { size: 7.5, color: '444444', after: 20 }));
    }
    progress?.(pi + 1, layouts.length);
    await yieldUi();
  }

  const dims = layouts[0];
  const landscape = dims.paperW > dims.paperH;
  const w = Math.round((landscape ? dims.paperH : dims.paperW) * PT_TO_TWIP);
  const h = Math.round((landscape ? dims.paperW : dims.paperH) * PT_TO_TWIP);
  const doc = new Document({
    creator: 'Anatomy Exam Builder',
    title: s.title || 'מבחן אנטומיה',
    styles: { default: { document: { run: { font: 'Arial', size: 22, rightToLeft: true } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: w, height: h, orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
            margin: { top: MARGIN * PT_TO_TWIP, bottom: MARGIN * PT_TO_TWIP, left: MARGIN * PT_TO_TWIP, right: MARGIN * PT_TO_TWIP },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBlob(doc);
}

/** קרדיטים כשורות טקסט שלמות (ללא שבירה לפי רוחב), לשימוש ב-DOCX */
function imagesCredits(L: PageLayout): string[] {
  return L.images.map((p) => {
    const img = p.image;
    const parts = [`איור ${figureLetter(p.index)}: ${img.title}`];
    if (img.source !== 'upload') {
      if (img.author) parts.push(img.author);
      parts.push(img.credit);
      parts.push(img.license.name + (img.license.url ? ` (${img.license.url})` : ''));
      if (img.pageUrl) parts.push(img.pageUrl);
      if (img.marks.length) parts.push('נוספו סימונים');
    } else {
      parts.push('תמונה שהועלתה על ידי המורה');
    }
    return parts.join(' | ');
  });
}

/* ------------------------------ Project ------------------------------ */

export function exportProject(images: ExamImage[], s: Settings): Blob {
  const project: Project = { format: 'anatomy-exam-builder', version: 1, savedAt: new Date().toISOString(), settings: s, images };
  return new Blob([JSON.stringify(project)], { type: 'application/json' });
}

export { importFromProject };
