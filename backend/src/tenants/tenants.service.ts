import { Injectable } from '@nestjs/common';
import { DEFAULT_LIST_TAKE } from '@/common/dto/paginated-result';
import { PrismaService } from '@/prisma/prisma.service';

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
}

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<TenantSummary[]> {
    return this.prisma.tenant.findMany({
      select: { id: true, slug: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
      take: DEFAULT_LIST_TAKE,
    });
  }
}
