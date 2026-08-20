import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import bg from '@/locales/bg/common.json';
import en from '@/locales/en/common.json';

// Guards the two ways translations rot: a key referenced in code that no bundle carries (the
// component then renders its inline English default, in every language), and the two bundles
// drifting apart. Plus one wording rule — "tenant" is our internal word, never user-facing.

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const SOURCE_DIRS = ['app', 'components', 'lib'];

function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null
      ? collectKeys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

function collectValues(obj: Record<string, unknown>, prefix = ''): Array<[string, string]> {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null
      ? collectValues(v as Record<string, unknown>, `${prefix}${k}.`)
      : [[`${prefix}${k}`, String(v)] as [string, string]],
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Every `t('some.key')` written as a plain single-quoted literal. Keys built from a template
 * string (`` t(`portal.rsvp.${opt}`) ``) cannot be resolved statically and are skipped — the
 * suites that render those screens cover them instead.
 */
function referencedKeys(): Map<string, string> {
  const found = new Map<string, string>();
  for (const dir of SOURCE_DIRS) {
    for (const file of sourceFiles(path.join(FRONTEND_ROOT, dir))) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        found.set(match[1]!, path.relative(FRONTEND_ROOT, file));
      }
    }
  }
  return found;
}

describe('translation bundles', () => {
  it('carries every key the code asks for', () => {
    const available = new Set(collectKeys(bg));
    const missing = [...referencedKeys()]
      .filter(([key]) => !available.has(key))
      .map(([key, file]) => `${key} (${file})`);
    expect(missing, `keys referenced in code but absent from bg/common.json: ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('keeps bg and en in step', () => {
    expect(collectKeys(en).sort()).toEqual(collectKeys(bg).sort());
  });

  it('says club, never tenant, in user-facing copy', () => {
    const offenders = [...collectValues(bg), ...collectValues(en)]
      .filter(([, value]) => /tenant|тенант/i.test(value))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders, `"tenant" is internal wording — say club: ${offenders.join(' | ')}`).toEqual(
      [],
    );
  });
});
