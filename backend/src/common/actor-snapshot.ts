import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

// Audit rows store who acted plus a point-in-time copy of their identity, so the
// record stays readable after the user is renamed or deleted. Shared by
// attendance marking and payment recording.
export async function resolveActorSnapshot(
  prisma: PrismaService,
  actorId: string,
  notFoundMessage: string,
): Promise<{ email: string; nameSnapshot: string | null }> {
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { email: true, firstName: true, lastName: true },
  });
  if (!actor) throw new NotFoundException(notFoundMessage);
  return {
    email: actor.email,
    nameSnapshot: [actor.firstName, actor.lastName].filter(Boolean).join(' ').trim() || null,
  };
}
