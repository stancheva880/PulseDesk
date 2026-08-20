import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Request types are generated from backend/openapi.json. Every `*Input` must stay a
// one-line alias to a generated schema — a hand-written one is exactly the drift
// PRD-0008 exists to stop.

const INPUT_TYPE_COUNT = 22;

const read = (...segments: string[]): string =>
  readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');

const apiResources = read('lib', 'api-resources.ts');
const apiSchema = read('lib', 'api-schema.d.ts');

describe('generated request types', () => {
  it('api-schema.d.ts declares the generated components', () => {
    expect(apiSchema).toMatch(/export interface components/);
    expect(apiSchema).toMatch(/CreateFeeDto:/);
  });

  it(`declares all ${INPUT_TYPE_COUNT} *Input types as one-line schema aliases`, () => {
    const declarations = [
      ...apiResources.matchAll(/^(?:export )?(?:interface|type) (\w+Input)\b.*$/gm),
    ];
    expect(declarations).toHaveLength(INPUT_TYPE_COUNT);
    for (const [line, name] of declarations) {
      expect(line, `${name} is not a one-line alias to a generated schema`).toMatch(
        /^type \w+Input = components\['schemas'\]\['\w+'\];$/,
      );
    }
  });
});
