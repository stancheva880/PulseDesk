import { z } from 'zod';

// The Docker and CI liveness probe. Two things here differ from every other module in the epic:
//
// 1. `timestamp` is ALREADY an ISO string when it leaves the controller
//    (`new Date().toISOString()`), not a Date — so no isoDate transform. Applying one would throw
//    on the endpoint container startup depends on.
// 2. `status` is pinned to the literal the controller returns, matching its declared return type.
//    A future degraded status fails loudly in dev rather than silently publishing a wrong contract.
//
// The docker-compose healthcheck only inspects the HTTP status (`r.ok`), never the body.

export const HealthSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  timestamp: z.string(),
});
