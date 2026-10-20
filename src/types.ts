export type LicenseLevel = 'free' | 'share' | 'unclear' | 'restricted' | 'user';

export interface LicenseInfo {
  /** שם הרישיון כפי שהמקור מדווח, לדוגמה "CC BY-SA 4.0" */
  name: string;
  url?: string;
  level: LicenseLevel;
  /** הערה קצרה למורה בעברית */
  note: string;
}

export type SourceId = 'commons' | 'wellcome' | 'upload';

/** תוצאת חיפוש (לפני שהמורה בחר אותה) */
export interface SearchResult {
  key: string;
  source: SourceId;
  sourceId: string;
  title: string;
  author: string;
  description: string;
  pageUrl: string;
  thumbUrl: string;
  /** כתובת התמונה לייצוא (נקבעת/מאומתת בזמן הבחירה) */
  fullUrl: string;
  width?: number;
  height?: number;
  mime?: string;
  license: LicenseInfo;
  credit: string;
}

export interface Mark {
  id: string;
  num: number;
  /** נקודת היעד על המבנה, יחסית לתמונה (0..1) */
  tx: number;
  ty: number;
  /** מיקום תווית המספר, יחסית לתמונה (0..1). בלי קו — זהה ליעד */
  lx: number;
  ly: number;
  /** האם לצייר קו וחץ מהתווית אל היעד */
  line: boolean;
}

export interface ExamImage {
  id: string;
  source: SourceId;
  sourceId: string;
  title: string;
  author: string;
  pageUrl: string;
  fileUrl: string;
  license: LicenseInfo;
  credit: string;
  fetchedAt: string;
  notes: string[];
  /** התמונה עצמה, כ-data URL, כדי שהייצוא והפרויקט יהיו עצמאיים */
  dataUrl: string;
  width: number;
  height: number;
  marks: Mark[];
}

export type PaperId = 'A4' | 'Letter';
export type MarkSize = 'small' | 'medium' | 'large';

export interface Settings {
  title: string;
  instructions: string;
  paper: PaperId;
  landscape: boolean;
  perPage: number;
  showTable: boolean;
  /** חלק העמוד שמוקצה לטבלה (0.15–0.6) */
  tableRatio: number;
  extraRows: number;
  numbering: 'continuous' | 'restart';
  showCredits: boolean;
  showCaptions: boolean;
  markSize: MarkSize;
  template: 'exam' | 'images' | 'custom';
}

export interface Project {
  format: 'anatomy-exam-builder';
  version: 1;
  savedAt: string;
  settings: Settings;
  images: ExamImage[];
}

export const DEFAULT_SETTINGS: Settings = {
  title: 'זיהוי מבנים אנטומיים',
  instructions: 'בתמונות שלפניך מסומנים מבנים במספרים. רשמו בטבלה את שם המבנה המסומן בכל מספר.',
  paper: 'A4',
  landscape: false,
  perPage: 1,
  showTable: true,
  tableRatio: 0.34,
  extraRows: 0,
  numbering: 'continuous',
  showCredits: true,
  showCaptions: true,
  markSize: 'medium',
  template: 'exam',
};
