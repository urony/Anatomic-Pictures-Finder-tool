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
}

/** הכפתורים המהירים, לפי סדר הלימוד: לב, כליה, כלי דם, תאי דם, רבייה, אנדוקרינולוגיה */
export const TOPICS: Topic[] = [
  { label: 'לב', group: 'קרדיולוגיה', sections: ['מבנה הלב', 'שכבות דופן הלב', 'מערכת ההולכה החשמלית'], lead: { he: 'לב', en: 'heart' } },
  { label: 'כליה', group: 'נפרולוגיה', lead: { he: 'כליה', en: 'kidney' } },
  { label: 'כלי דם', group: 'קרדיולוגיה', sections: ['כלי דם', 'מבנה דופן כלי הדם'], lead: { he: 'כלי דם', en: 'blood vessels' } },
  {
    label: 'תאי דם',
    group: 'המטולוגיה ולימפה',
    sections: ['תאי דם לבנים'],
    lead: { he: 'תאי דם', en: 'blood cells' },
    extra: [
      { he: 'תאי דם אדומים', en: 'red blood cells erythrocytes' },
      { he: 'טסיות דם', en: 'platelets' },
    ],
  },
  { label: 'מערכת הרבייה הזכרית', group: 'מערכת הרבייה הזכרית', lead: { he: 'מערכת הרבייה הזכרית', en: 'male reproductive system' } },
  { label: 'מערכת הרבייה הנקבית', group: 'גינקולוגיה', lead: { he: 'מערכת הרבייה הנקבית', en: 'female reproductive system' } },
  { label: 'מערכת אנדוקרינית', group: 'אנדוקרינולוגיה', lead: { he: 'מערכת אנדוקרינית', en: 'endocrine system' } },
  { label: 'היפותלמוס', group: 'אנדוקרינולוגיה', sections: ['היפותלמוס'], lead: { he: 'היפותלמוס', en: 'hypothalamus' } },
  { label: 'היפופיזה', group: 'אנדוקרינולוגיה', sections: ['היפופיזה'], lead: { he: 'היפופיזה', en: 'pituitary gland' } },
  { label: 'בלוטת התריס', group: 'אנדוקרינולוגיה', sections: ['בלוטת התריס'], lead: { he: 'בלוטת התריס', en: 'thyroid gland' } },
  { label: 'יותרת התריס', group: 'אנדוקרינולוגיה', sections: ['יותרת התריס'], lead: { he: 'יותרת התריס', en: 'parathyroid gland' } },
  { label: 'יותרת הכליה', group: 'אנדוקרינולוגיה', sections: ['יותרת הכליה'], lead: { he: 'יותרת הכליה', en: 'adrenal gland' } },
  { label: 'לבלב', group: 'אנדוקרינולוגיה', sections: ['בלוטת הלבלב'], lead: { he: 'לבלב', en: 'pancreas' } },
];

export interface TopicTerm {
  he: string;
  en: string;
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
