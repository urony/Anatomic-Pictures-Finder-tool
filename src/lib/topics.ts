import type { TermsFile } from './terms';

export interface Topic {
  /** הטקסט על הכפתור */
  label: string;
  /** תחום במילון (group) */
  group: string;
  /** אם מוגדר: רק סעיפים (section) שהשם שלהם מכיל אחת מהמחרוזות */
  sections?: string[];
  /** מונח פתיחה (ראשון ברשימה) */
  lead: { he: string; en: string };
  /** מונחים נוספים שלא מופיעים במסמך המונחים */
  extra?: { he: string; en: string }[];
  /** מילות מפתח נוספות לחיפוש במאגר המורים בלבד (כל מה ששייך לנושא, גם בעקיפין) */
  libraryKeywords?: string[];
}

/** הכפתורים המהירים, לפי סדר הלימוד: לב, כליה, כלי דם, תאי דם, רבייה, אנדוקרינולוגיה */
export const TOPICS: Topic[] = [
  { label: 'לב', group: 'קרדיולוגיה', sections: ['מבנה הלב', 'שכבות דופן הלב', 'מערכת ההולכה החשמלית'], lead: { he: 'לב', en: 'heart' }, libraryKeywords: ['heart', 'cardiac', 'cardio', 'ventricle', 'atrium', 'valve', 'aorta', 'coronary', 'pericardium', 'myocardium', 'לב'] },
  { label: 'כליה', group: 'נפרולוגיה', lead: { he: 'כליה', en: 'kidney' }, libraryKeywords: ['kidney', 'renal', 'nephron', 'glomerulus', 'ureter', 'bladder', 'urethra', 'urinary', 'כליה', 'נפרון'] },
  { label: 'כלי דם', group: 'קרדיולוגיה', sections: ['כלי דם', 'מבנה דופן כלי הדם'], lead: { he: 'כלי דם', en: 'blood vessels' }, libraryKeywords: ['vessel', 'artery', 'vein', 'capillary', 'aorta', 'vena', 'cava', 'carotid', 'circulatory', 'vascular', 'tunica', 'endothelium', 'עורק', 'וריד'] },
  {
    label: 'תאי דם',
    group: 'המטולוגיה ולימפה',
    sections: ['תאי דם לבנים'],
    lead: { he: 'תאי דם', en: 'blood cells' },
    libraryKeywords: ['blood', 'cell', 'cells', 'erythrocyte', 'leukocyte', 'neutrophil', 'eosinophil', 'basophil', 'monocyte', 'lymphocyte', 'platelet', 'thrombocyte', 'smear', 'דם'],
    extra: [
      { he: 'תאי דם אדומים', en: 'red blood cells erythrocytes' },
      { he: 'טסיות דם', en: 'platelets' },
    ],
  },
  { label: 'מערכת הרבייה הזכרית', group: 'מערכת הרבייה הזכרית', lead: { he: 'מערכת הרבייה הזכרית', en: 'male reproductive system' }, libraryKeywords: ['male', 'reproductive', 'testis', 'testes', 'testicle', 'epididymis', 'deferens', 'prostate', 'seminal', 'penis', 'sperm', 'spermatozoa', 'scrotum', 'sertoli', 'leydig', 'אשך', 'ערמונית'] },
  { label: 'מערכת הרבייה הנקבית', group: 'גינקולוגיה', lead: { he: 'מערכת הרבייה הנקבית', en: 'female reproductive system' }, libraryKeywords: ['female', 'reproductive', 'ovary', 'ovaries', 'ovarian', 'ovum', 'oocyte', 'follicle', 'uterus', 'uterine', 'fallopian', 'tube', 'oviduct', 'cervix', 'vagina', 'vulva', 'endometrium', 'myometrium', 'placenta', 'breast', 'mammary', 'שחלה', 'רחם', 'חצוצרה'] },
  { label: 'מערכת אנדוקרינית', group: 'אנדוקרינולוגיה', lead: { he: 'מערכת אנדוקרינית', en: 'endocrine system' }, libraryKeywords: ['endocrine', 'gland', 'hormone', 'hypothalamus', 'pituitary', 'hypophysis', 'thyroid', 'parathyroid', 'adrenal', 'suprarenal', 'pancreas', 'islets', 'langerhans', 'insulin', 'glucagon', 'cortisol', 'ovary', 'testis', 'pineal', 'thymus', 'בלוטה', 'הורמון'] },
  { label: 'היפותלמוס', group: 'אנדוקרינולוגיה', sections: ['היפותלמוס'], lead: { he: 'היפותלמוס', en: 'hypothalamus' }, libraryKeywords: ['hypothalamus', 'pituitary', 'hormone', 'releasing', 'brain'] },
  { label: 'היפופיזה', group: 'אנדוקרינולוגיה', sections: ['היפופיזה'], lead: { he: 'היפופיזה', en: 'pituitary gland' }, libraryKeywords: ['pituitary', 'hypophysis', 'adenohypophysis', 'neurohypophysis', 'sella', 'turcica', 'hormone', 'oxytocin', 'prolactin', 'vasopressin', 'ADH', 'TSH', 'ACTH', 'FSH'] },
  { label: 'בלוטת התריס', group: 'אנדוקרינולוגיה', sections: ['בלוטת התריס'], lead: { he: 'בלוטת התריס', en: 'thyroid gland' }, libraryKeywords: ['thyroid', 'thyroxine', 'calcitonin', 'follicle', 'isthmus', 'goiter', 'T3', 'T4', 'תריס'] },
  { label: 'יותרת התריס', group: 'אנדוקרינולוגיה', sections: ['יותרת התריס'], lead: { he: 'יותרת התריס', en: 'parathyroid gland' }, libraryKeywords: ['parathyroid', 'thyroid', 'chief', 'osteoclast', 'osteoblast', 'calcium', 'PTH'] },
  { label: 'יותרת הכליה', group: 'אנדוקרינולוגיה', sections: ['יותרת הכליה'], lead: { he: 'יותרת הכליה', en: 'adrenal gland' }, libraryKeywords: ['adrenal', 'suprarenal', 'cortex', 'medulla', 'aldosterone', 'cortisol', 'adrenaline', 'epinephrine', 'catecholamine'] },
  { label: 'לבלב', group: 'אנדוקרינולוגיה', sections: ['בלוטת הלבלב'], lead: { he: 'לבלב', en: 'pancreas' }, libraryKeywords: ['pancreas', 'pancreatic', 'islets', 'langerhans', 'insulin', 'glucagon', 'acinar', 'alpha', 'beta', 'delta'] },
];

export interface TopicTerm {
  he: string;
  en: string;
}

/**
 * ביטויים לחיפוש במאגר המורים בלבד: מונח הפתיחה, שם הכפתור ורשימת מילות המפתח של הנושא.
 * במכוון לא כולל את כל מונחי המילון — מונחים כמו "Thyroid Stimulating Hormone" שייכים להיפופיזה
 * אבל היו מביאים תמונות בלוטת תריס, ו"Kidney Arteries" היו מציפים את כלי הדם בתמונות כליה.
 */
export function libraryPhrases(t: Topic): string[] {
  return [t.lead.en, t.lead.he, t.label, ...(t.libraryKeywords ?? []), ...(t.extra ?? []).flatMap((x) => [x.en, x.he])];
}

/** כל מונחי הנושא (מונח פתיחה ראשון, בלי כפילויות) */
export function termsForTopic(topic: Topic, file: TermsFile | null): TopicTerm[] {
  const out: TopicTerm[] = [topic.lead];
  const seen = new Set([topic.lead.en.toLowerCase()]);
  const push = (t: TopicTerm) => {
    const k = t.en.toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  for (const e of file?.terms ?? []) {
    if (e.group !== topic.group) continue;
    const section = (e as { section?: string }).section ?? '';
    if (topic.sections && !topic.sections.some((s) => section.includes(s))) continue;
    if (!e.en[0]) continue;
    push({ he: e.he[0], en: e.en[0] });
  }
  for (const x of topic.extra ?? []) push(x);
  return out;
}
