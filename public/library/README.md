# מאגר המורים

מעלים לכאן תמונות (PNG / JPG / WebP / GIF). **שם הקובץ הוא מילות החיפוש** באנגלית, עם קו תחתון בין מילים:

    kidney_nephron.png        -> kidney, nephron
    heart_valves_labeled.jpg  -> heart, valves, labeled

אפשר לארגן בתיקיות משנה (שם התיקייה נחשב גם הוא מילת חיפוש): `heart/valves.png`.

## קרדיט (אופציונלי, מומלץ)
שורה בקובץ `credits.csv` (נפתח ב-Excel, לשמור כ-CSV UTF-8):

    file,author,license,source
    kidney_nephron.png,Jane Doe,CC BY 4.0,https://example.org/page

בלי שורה — התמונה נכנסת עם הסימון "הועלתה על ידי צוות הכלי". אם יש license, הקרדיט מודפס אוטומטית במבחן.

האינדקס (`index.json`) נבנה אוטומטית בכל בנייה (`npm run build`) — לא עורכים אותו ידנית.
