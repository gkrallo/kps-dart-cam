/**
 * Var sessionens insamlade material hamnar.
 *
 * `capture/` är gitignorerad: allt som samlas in under en session är råmaterial,
 * och det som visar sig vara värt att behålla flyttas MEDVETET in som fixtur
 * under `src/utils/__tests__/fixtures/`. Annars växer repot med hundratals
 * megabyte skärmdumpar som ingen tittar på igen.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export function repoRoot() {
  return resolve(here, '..');
}

export function sessionDir(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  return resolve(repoRoot(), 'capture', day);
}
