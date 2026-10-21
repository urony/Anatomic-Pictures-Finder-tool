import { DEFAULT_SETTINGS, type Cover, type ExamImage, type Mark, type Project, type Settings } from '../types';

const clamp01 = (n: unknown, d = 0.5): number => (typeof n === 'number' && isFinite(n) ? Math.min(1, Math.max(0, n)) : d);

/** קורא ומאמת קובץ פרויקט. לא סומך על התוכן: בודק סוגים ומנקה שדות. */
export function importFromProject(text: string): { images: ExamImage[]; settings: Settings } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('הקובץ אינו קובץ פרויקט תקין');
  }
  const p = raw as Partial<Project>;
  if (!p || p.format !== 'anatomy-exam-builder' || !Array.isArray(p.images)) {
    throw new Error('זה לא קובץ פרויקט של הכלי');
  }
  const images: ExamImage[] = [];
  for (const i of p.images as Partial<ExamImage>[]) {
    if (typeof i.dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(i.dataUrl)) continue;
    const marks: Mark[] = Array.isArray(i.marks)
      ? i.marks.map((m, k) => ({
          id: typeof m.id === 'string' ? m.id : `m${k}`,
          num: typeof m.num === 'number' ? m.num : k + 1,
          tx: clamp01(m.tx),
          ty: clamp01(m.ty),
          lx: clamp01(m.lx),
          ly: clamp01(m.ly),
          line: !!m.line,
        }))
      : [];
    const covers: Cover[] = Array.isArray(i.covers)
      ? i.covers.map((c, k) => ({
          id: typeof c.id === 'string' ? c.id : `c${k}`,
          x: clamp01(c.x, 0),
          y: clamp01(c.y, 0),
          w: clamp01(c.w, 0.05),
          h: clamp01(c.h, 0.05),
          color: typeof c.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : '#ffffff',
        }))
      : [];
    let crop: ExamImage['crop'];
    const ci = i.crop;
    if (ci && typeof ci.src === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(ci.src)) {
      const w = clamp01(ci.w, 1);
      const h = clamp01(ci.h, 1);
      if (w >= 0.01 && h >= 0.01) {
        crop = { src: ci.src, srcW: Number(ci.srcW) || 1, srcH: Number(ci.srcH) || 1, x: clamp01(ci.x, 0), y: clamp01(ci.y, 0), w, h };
      }
    }
    images.push({
      id: String(i.id ?? Math.random().toString(36).slice(2)),
      source: i.source === 'wellcome' || i.source === 'upload' || i.source === 'openverse' || i.source === 'library' ? i.source : 'commons',
      sourceId: String(i.sourceId ?? ''),
      title: String(i.title ?? ''),
      author: String(i.author ?? ''),
      pageUrl: String(i.pageUrl ?? ''),
      fileUrl: String(i.fileUrl ?? ''),
      license: {
        name: String(i.license?.name ?? 'לא ידוע'),
        url: i.license?.url,
        level: i.license?.level ?? 'unclear',
        note: String(i.license?.note ?? ''),
      },
      credit: String(i.credit ?? ''),
      fetchedAt: String(i.fetchedAt ?? ''),
      notes: Array.isArray(i.notes) ? i.notes.map(String) : [],
      dataUrl: i.dataUrl,
      width: Number(i.width) || 1,
      height: Number(i.height) || 1,
      marks,
      covers,
      ...(crop ? { crop } : {}),
    });
  }
  return { images, settings: {
      ...DEFAULT_SETTINGS,
      ...(p.settings ?? {}),
      tableCols: { ...DEFAULT_SETTINGS.tableCols, ...(p.settings?.tableCols ?? {}) },
    } };
}
