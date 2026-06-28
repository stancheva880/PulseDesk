import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ContactPerson } from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { DEFAULT_LIST_TAKE } from '@/common/dto/paginated-result';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateContactDto } from './dto/create-contact.dto';
import type { UpdateContactDto } from './dto/update-contact.dto';

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: LocationScopeService,
  ) {}

  async list(
    tenantId: string,
    traineeId: string,
    user?: AuthenticatedUser,
  ): Promise<ContactPerson[]> {
    await this.assertTraineeAccessible(tenantId, traineeId, user);
    return this.prisma.contactPerson.findMany({
      where: { traineeId, tenantId },
      orderBy: [{ isPrimary: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
      take: DEFAULT_LIST_TAKE,
    });
  }

  async findById(
    tenantId: string,
    traineeId: string,
    id: string,
    user?: AuthenticatedUser,
  ): Promise<ContactPerson> {
    await this.assertTraineeAccessible(tenantId, traineeId, user);
    const contact = await this.prisma.contactPerson.findFirst({
      where: { id, traineeId, tenantId },
    });
    if (!contact) throw new NotFoundException(`Contact ${id} not found`);
    return contact;
  }

  async create(
    tenantId: string,
    traineeId: string,
    dto: CreateContactDto,
    user?: AuthenticatedUser,
  ): Promise<ContactPerson> {
    await this.assertTraineeAccessible(tenantId, traineeId, user);
    return this.prisma.contactPerson.create({
      data: {
        tenantId,
        traineeId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        relationship: dto.relationship,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        isPrimary: dto.isPrimary ?? false,
      },
    });
  }

  async update(
    tenantId: string,
    traineeId: string,
    id: string,
    dto: UpdateContactDto,
    user?: AuthenticatedUser,
  ): Promise<ContactPerson> {
    await this.findById(tenantId, traineeId, id, user);
    const data: Prisma.ContactPersonUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.relationship !== undefined) data.relationship = dto.relationship;
    if (dto.phone !== undefined) data.phone = dto.phone ?? null;
    if (dto.email !== undefined) data.email = dto.email ?? null;
    if (dto.isPrimary !== undefined) data.isPrimary = dto.isPrimary;
    return this.prisma.contactPerson.update({ where: { id }, data });
  }

  async delete(
    tenantId: string,
    traineeId: string,
    id: string,
    user?: AuthenticatedUser,
  ): Promise<void> {
    await this.findById(tenantId, traineeId, id, user);
    await this.prisma.contactPerson.delete({ where: { id } });
  }

  private async assertTraineeAccessible(
    tenantId: string,
    traineeId: string,
    user?: AuthenticatedUser,
  ): Promise<void> {
    const allowedIds = user ? await this.scope.getAccessibleLocationIds(user, tenantId) : null;
    const trainee = await this.prisma.trainee.findFirst({
      where: {
        id: traineeId,
        tenantId,
        ...(allowedIds === null
          ? {}
          : { locations: { some: { id: { in: allowedIds } } } }),
      },
      select: { id: true },
    });
    if (!trainee) throw new NotFoundException(`Trainee ${traineeId} not found`);
  }
}
