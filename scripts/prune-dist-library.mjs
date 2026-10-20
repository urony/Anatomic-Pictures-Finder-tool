// אחרי הבנייה: מסיר מ-dist/library את קבצי המקור הכבדים (נשארים רק _web, _thumbs ו-index.json),
// כדי שהאתר המפורסם יהיה קל. המקורות נשארים במאגר ב-GitHub.
import fs from 'node:fs';
import path from 'node:path';

const dir = 'dist/library';
if (fs.existsSync(dir)) {
  let removed = 0;
  let bytes = 0;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === '_web' || e.name === '_thumbs') continue;
        walk(p);
        if (!fs.readdirSync(p).length) fs.rmdirSync(p);
      } else if (/\.(png|jpe?g|webp|gif)$/i.test(e.name)) {
        bytes += fs.statSync(p).size;
        fs.unlinkSync(p);
        removed++;
      }
    }
  })(dir);
  console.log(`dist/library: הוסרו ${removed} קבצי מקור (${(bytes / 1e6).toFixed(0)}MB)`);
}
