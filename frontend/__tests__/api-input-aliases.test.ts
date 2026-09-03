import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Request types are generated from backend/openapi.json. Every `*Input` must stay a
// one-line alias to a generated schema — a hand-written one is exactly the drift
// PRD-0008 exists to stop.

// Approved TEST CHANGE REQUEST, 2026-08-22: 22 → 23 for CreateCardInput (TKT-0106,
// visit cards) — itself a one-line generated-schema alias, per this file's rule.
// Approved TEST CHANGE REQUEST, 2026-08-22: 23 → 24 for CreateRefundInput (TKT-0105,
// refund ledger — named in the approved tech plan) — itself a one-line generated-schema
// alias, per this file's rule.
// Approved TEST CHANGE REQUEST, 2026-08-22: 24 → 25 for GenerateCourseFeesInput (TKT-0110,
// course fees — named in the approved tech plan) — same terms.
// Approved TEST CHANGE REQUEST, 2026-08-23: 25 → 26 for CreateWaitlistEntryInput (TKT-0112,
// waitlist — named in the approved tech plan) — same terms.
// Approved TEST CHANGE REQUEST, 2026-08-23: 26 → 27 for ClaimWaitlistInput (TKT-0114,
// claim-mode promotion — named in the approved tech plan) — same terms.
// Approved TEST CHANGE REQUEST, 2026-09-03: 27 → 29 for UpdateLocationPaymentDetailsInput and
// UpdateTenantPaymentDetailsInput (TKT-0128, location/club payment details) — same terms.
const INPUT_TYPE_COUNT = 29;

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
