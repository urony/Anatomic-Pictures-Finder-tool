export type LicenseLevel = 'free' | 'share' | 'unclear' | 'restricted' | 'user';

export interface LicenseInfo {
  /** שם הרישיון כפי שהמקור מדווח, לדוגמה "CC BY-SA 4.0" */
  name: string;
  url?: string;
  level: LicenseLevel;
  /** הערה קצרה למורה בעברית */
  note: string;
}

export type SourceId = 'commons' | 'wellcome' | 'openverse' | 'library' | 'upload';

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
  /** חיפוש לפי נושא: שם המונח שהתוצאה שייכת לו, והסדר שלו */
  topic?: string;
  topicIdx?: number;
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

/** מלבן הסתרה (למשל על טקסט שמודפס בתוך התמונה); קואורדינטות יחסיות לתמונה */
export interface Cover {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
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
  covers?: Cover[];
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
  /** all = שורה לכל מספר מסומן (המספרים מודפסים); pick = N שורות ריקות, התלמיד בוחר מספרים */
  tableMode: 'all' | 'pick';
  pickCount: number;
  tableCols: { en: boolean; fn: boolean };
  tableInstructions: string;
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

export const TABLE_INSTR_ALL =
  'העתיקו למחברת את הטבלה הבאה, והשלימו אותה: כתבו בטבלה את שם החלק/החומר המסומן בכל מספר באיור, את שמו באנגלית ואחד מתפקידיו.';
export const TABLE_INSTR_PICK =
  'העתיקו למחברת את הטבלה הבאה, והשלימו אותה: בחרו ארבעה מבין החלקים/החומרים הממוספרים באיור, וכתבו בטבלה את המספר של כל חלק/חומר באיור, את שמו בעברית, את שמו באנגלית ואחד מתפקידיו.';

export const DEFAULT_SETTINGS: Settings = {
  title: 'זיהוי מבנים אנטומיים',
  instructions: 'בתמונות שלפניך מסומנים מבנים במספרים. רשמו בטבלה את שם המבנה המסומן בכל מספר.',
  paper: 'A4',
  landscape: false,
  perPage: 1,
  showTable: true,
  tableRatio: 0.27,
  extraRows: 0,
  tableMode: 'all',
  pickCount: 4,
  tableCols: { en: true, fn: true },
  tableInstructions: TABLE_INSTR_ALL,
  numbering: 'continuous',
  showCredits: true,
  showCaptions: true,
  markSize: 'medium',
  template: 'exam',
};
