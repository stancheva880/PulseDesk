import { Prisma } from '@prisma/client';

// Shared helpers for Prisma relation payloads + error classification, used by the
// services that manage many-to-many id lists (classes, trainees, locations).

export function connectMany(ids?: string[]) {
  return ids && ids.length > 0 ? { connect: ids.map((id) => ({ id })) } : undefined;
}

export function setMany(ids: string[]) {
  return { set: ids.map((id) => ({ id })) };
}

export function isUniqueConstraintError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}
