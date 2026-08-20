import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '@/auth/decorators/roles.decorator';
import { DEFAULT_LIST_TAKE } from '@/common/dto/paginated-result';
import { ResponseSchema } from '@/common/response-schema';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantsService } from './tenants.service';
import { CreatedTenantSchema, TenantSummaryListSchema } from './tenants.schema';

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
}

/** POST /tenants: the club, plus whether its administrator's mail actually left. */
export interface CreatedTenant extends TenantSummary {
  notificationSent: boolean;
}

// SUPER_ADMIN-only read-only endpoint that powers the frontend tenant selector.
// The RolesGuard's SUPER_ADMIN bypass means this is also reachable by SUPER_ADMIN
// without further annotation; ADMIN/EMPLOYEE/CUSTOMER are rejected with 403.
@ApiBearerAuth()
@Controller('tenants')
@Roles(UserRole.SUPER_ADMIN)
export class TenantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
  ) {}

  @Get()
  @ResponseSchema('TenantSummaryList', TenantSummaryListSchema)
  list(): Promise<TenantSummary[]> {
    return this.prisma.tenant.findMany({
      select: { id: true, slug: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
      take: DEFAULT_LIST_TAKE,
    });
  }

  // Onboards a club with its first location and first administrator. PRD: the super admin is the
  // only role that creates tenants and assigns their initial admins.
  @Post()
  @ResponseSchema('CreatedTenant', CreatedTenantSchema)
  create(@Body() dto: CreateTenantDto): Promise<CreatedTenant> {
    return this.tenants.create(dto);
  }
}
