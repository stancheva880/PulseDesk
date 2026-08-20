import { describe, expect, it } from 'vitest';
import { HealthSchema } from './health.schema';

// GET /health is the Docker and CI liveness probe. Its timestamp is ALREADY an ISO string when
// it leaves the controller (new Date().toISOString()), unlike every other module in this epic
// where timestamps are Date objects — so this schema must not apply the isoDate transform.

describe('HealthSchema', () => {
  it('declares the health response with an ISO timestamp string', () => {
    const parsed = HealthSchema.parse({
      status: 'ok',
      service: 'pulsedesk-backend',
      timestamp: '2026-08-17T09:00:00.000Z',
    });
    expect(parsed).toEqual({
      status: 'ok',
      service: 'pulsedesk-backend',
      timestamp: '2026-08-17T09:00:00.000Z',
    });
  });

  it('rejects a Date, which would mean the controller stopped serializing it', () => {
    expect(
      HealthSchema.safeParse({
        status: 'ok',
        service: 'pulsedesk-backend',
        timestamp: new Date(),
      }).success,
    ).toBe(false);
  });

  it('pins status to the literal the controller returns', () => {
    expect(
      HealthSchema.safeParse({
        status: 'degraded',
        service: 'pulsedesk-backend',
        timestamp: '2026-08-17T09:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
