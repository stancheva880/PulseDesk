import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole, type Location } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';
import type { PaginatedResult } from '@/common/dto/paginated-result';
import { NoContent, ResponseSchema } from '@/common/response-schema';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateLocationPaymentDetailsDto } from './dto/update-location-payment-details.dto';
import { LocationSchema, PaginatedLocationSchema } from './locations.schema';
import { LocationsService } from './locations.service';

// Reads: ADMIN + EMPLOYEE (ADMIN list is scoped to their assigned locations).
// Writes: SUPER_ADMIN only — managing the tenant's location footprint is a
// system-administrator concern. The RolesGuard's SUPER_ADMIN bypass means SUPER_ADMIN
// also passes the read-floor without listing them explicitly.
// TKT-0128 carves out one exception: payment-details is ADMIN's to run day to day (scoped
// to their own assigned locations), so it overrides with its own, wider @Roles().
@ApiBearerAuth()
@Controller('locations')
@Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @ApiOperation({ summary: 'List the locations you can reach in this club. Paginated.' })
  @Get()
  @ResponseSchema('PaginatedLocation', PaginatedLocationSchema)
  list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<Location>> {
    return this.locations.list(tenantId, user, query);
  }

  @ApiOperation({ summary: 'Read one location.' })
  @Get(':id')
  @ResponseSchema('Location', LocationSchema)
  findOne(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Location> {
    return this.locations.findById(tenantId, id, user);
  }

  @ApiOperation({ summary: 'Create a location. SUPER_ADMIN only.' })
  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  @ResponseSchema('Location', LocationSchema)
  create(@TenantId() tenantId: string, @Body() dto: CreateLocationDto): Promise<Location> {
    return this.locations.create(tenantId, dto);
  }

  @ApiOperation({ summary: 'Change a location. Deactivating it also stops its weekly slots.' })
  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN)
  @ResponseSchema('Location', LocationSchema)
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
  ): Promise<Location> {
    return this.locations.update(tenantId, id, dto);
  }

  @ApiOperation({
    summary: 'Change where customers send money for this location. ADMIN or SUPER_ADMIN.',
  })
  @Patch(':id/payment-details')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ResponseSchema('Location', LocationSchema)
  updatePaymentDetails(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateLocationPaymentDetailsDto,
  ): Promise<Location> {
    return this.locations.updatePaymentDetails(tenantId, id, dto, user);
  }

  @ApiOperation({ summary: 'Delete a location. Refused when it has sessions or weekly slots.' })
  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  // Declared rather than skipped: an undeclared response is the same gap this epic closes.
  @ResponseSchema('LocationNoContent', NoContent)
  async remove(@TenantId() tenantId: string, @Param('id') id: string): Promise<void> {
    await this.locations.delete(tenantId, id);
  }
}
