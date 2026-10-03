/* What the documents' pictures are held to: WebP, and 400 KB or less each.
   A rule with no check is no rule: installer-started.png went in at 1.8 MB
   while docs/screens/README.md said 400 KB (2349174).  Checked by
   tests/docs/pictures.test.ts over every folder of pictures the documents
   show; tools/capture-screens.ts and the CI job that commits the Windows
   pictures keep to it as they write. */

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const MAX_PICTURE_BYTES = 400 * 1024;
const PICTURE = /\.(png|jpe?g|gif|webp)$/i;

/** The pictures in `dirs` (not their subfolders) that break the rule, each with why. */
export function pictureFaults(dirs: string[], max = MAX_PICTURE_BYTES): string[] {
  const faults: string[] = [];
  for (const dir of dirs) {
    for (const name of readdirSync(dir)) {
      if (!PICTURE.test(name)) continue;
      const file = path.join(dir, name), bytes = statSync(file).size;
      if (!name.toLowerCase().endsWith('.webp')) faults.push(`${file}: not WebP`);
      if (bytes > max) faults.push(`${file}: ${bytes} bytes, over ${max}`);
    }
  }
  return faults;
}
