import type { LicenseInfo } from '../types';

/**
 * סיווג שמרני של רישיון לפי הטקסט שהמקור מדווח. לא ניחוש: אם לא מזהים — "לא ברור".
 * זהו מידע עזר ולא חוות דעת משפטית.
 */
export function classifyLicense(rawName: string | undefined, url?: string): LicenseInfo {
  const name = (rawName || '').trim();
  const n = name.toLowerCase().replace(/\s+/g, ' ');
  if (!n) {
    return { name: 'לא ידוע', url, level: 'unclear', note: 'המקור לא מציין רישיון. לא מומלץ להשתמש.' };
  }
  if (/\bnd\b|noderiv|no deriv/.test(n)) {
    return { name, url, level: 'restricted', note: 'הרישיון אוסר יצירת נגזרות — הוספת סימונים עלולה להיחשב שינוי. לא מומלץ.' };
  }
  if (/\bnc\b|noncommercial|non-commercial|non commercial/.test(n)) {
    return { name, url, level: 'restricted', note: 'לשימוש לא מסחרי בלבד. בדקו שהשימוש שלכם עומד בתנאי הרישיון.' };
  }
  if (/\bcc0\b|cc zero|public domain|pdm|pd-|\bpd\b|no known copyright|ללא זכויות/.test(n)) {
    return { name, url, level: 'free', note: 'נחלת הכלל / ללא הגבלות. קרדיט מומלץ.' };
  }
  if (/\bcc by-sa\b|cc-by-sa|by-sa|share ?alike|gfdl/.test(n)) {
    return { name, url, level: 'share', note: 'נדרש קרדיט; מסמך שמכיל את התמונה יפורסם באותו רישיון (שיתוף זהה).' };
  }
  if (/\bcc by\b|cc-by|\bby\b ?\d|attribution/.test(n)) {
    return { name, url, level: 'free', note: 'נדרש קרדיט ליוצר ולרישיון, ואזכור שבוצע שינוי (סימונים).' };
  }
  return { name, url, level: 'unclear', note: 'רישיון לא מוכר לכלי. בדקו ידנית בדף המקור.' };
}

export const LEVEL_LABEL: Record<LicenseInfo['level'], string> = {
  free: 'רישיון ברור',
  share: 'רישיון ברור (שיתוף זהה)',
  unclear: 'רישיון לא ברור',
  restricted: 'מוגבל — בדקו',
  user: 'הועלתה ידנית',
};

/** האם תמונה כזו מוצגת כברירת מחדל בחיפוש (מסלול שמרני) */
export function isDefaultSafe(l: LicenseInfo): boolean {
  return l.level === 'free' || l.level === 'share' || l.level === 'user';
}

/** מסיר תגיות HTML מטקסט שמגיע מ-API ומחזיר טקסט רגיל בלבד (בלי רינדור HTML חיצוני). */
export function stripHtml(html: string | undefined): string {
  if (!html) return '';
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]*>/g, '').trim();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

/** מאפשר רק קישורי http/https */
export function safeUrl(u: string | undefined): string | undefined {
  if (!u) return undefined;
  try {
    const x = new URL(u, 'https://x.invalid');
    return x.protocol === 'https:' || x.protocol === 'http:' ? u : undefined;
  } catch {
    return undefined;
  }
}
