import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outDir = path.join(process.cwd(), 'out');

try {
  await access(outDir);
} catch {
  console.error('Expected the static export at ./out. Run `npm run build` first.');
  process.exit(1);
}

await writeFile(path.join(outDir, '.nojekyll'), '');
console.log('Prepared GitHub Pages artifacts in out/.nojekyll');
