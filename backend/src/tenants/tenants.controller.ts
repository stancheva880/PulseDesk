import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import { DEFAULT_LIST_TAKE } from '@/common/dto/paginated-result';
import { NoContent, ResponseSchema } from '@/common/response-schema';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantPaymentDetailsDto } from './dto/update-tenant-payment-details.dto';
import { TenantsService } from './tenants.service';
import {
  CreatedTenantSchema,
  TenantPaymentDetailsSchema,
  TenantSummaryListSchema,
} from './tenants.schema';

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
// TKT-0128 carves out one exception: the payment-details pair is ADMIN's to run day to day
// too (the club's own shared bank/Revolut/MyPOS/cash default), so those two routes override
// with their own, wider @Roles().
@ApiBearerAuth()
@Controller('tenants')
@Roles(UserRole.SUPER_ADMIN)
export class TenantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
  ) {}

  @ApiOperation({ summary: 'List every club, for the club picker.' })
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
  @ApiOperation({ summary: 'Create a club with its first location and its first administrator.' })
  @Post()
  @ResponseSchema('CreatedTenant', CreatedTenantSchema)
  create(@Body() dto: CreateTenantDto): Promise<CreatedTenant> {
    return this.tenants.create(dto);
  }

  @ApiOperation({ summary: "Read the club's shared default payment details." })
  @Get('payment-details')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ResponseSchema('TenantPaymentDetails', TenantPaymentDetailsSchema)
  getPaymentDetails(@TenantId() tenantId: string) {
    return this.tenants.getPaymentDetails(tenantId);
  }

  @ApiOperation({ summary: "Change the club's shared default payment details." })
  @Patch('payment-details')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ResponseSchema('TenantPaymentDetails', TenantPaymentDetailsSchema)
  updatePaymentDetails(
    @TenantId() tenantId: string,
    @Body() dto: UpdateTenantPaymentDetailsDto,
  ) {
    return this.tenants.updatePaymentDetails(tenantId, dto);
  }

  // TKT-0132: deletes the club and everything that belongs to it (schema.prisma cascades).
  // Irreversible — the frontend confirms by asking the operator to type the club's name.
  @ApiOperation({ summary: 'Delete a club and everything that belongs to it. Irreversible.' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema('TenantNoContent', NoContent)
  async remove(@Param('id') id: string): Promise<void> {
    await this.tenants.delete(id);
  }
}
