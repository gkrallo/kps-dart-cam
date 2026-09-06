// Kopierar opencv.js från npm-paketet till public/ så att appen serverar den
// själv istället för att hänga på docs.opencv.org (som är en dokumentationssajt,
// inte ett CDN). Filen är gitignorerad - versionen styrs av package.json.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkg = dirname(require.resolve('@techstark/opencv-js/package.json'));
const src = join(pkg, 'dist', 'opencv.js');
const dest = join(process.cwd(), 'public', 'opencv.js');

if (!existsSync(src)) {
  console.error('Hittade inte opencv.js. Kör npm install först.');
  process.exit(1);
}
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log('opencv.js kopierad till public/');
