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
} from '@nestjs/common';
import { UserRole, type Location } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationsService } from './locations.service';

// Reads: ADMIN + EMPLOYEE (ADMIN list is scoped to their assigned locations).
// Writes: SUPER_ADMIN only — managing the tenant's location footprint is a
// system-administrator concern. The RolesGuard's SUPER_ADMIN bypass means SUPER_ADMIN
// also passes the read-floor without listing them explicitly.
@Controller('locations')
@Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Location[]> {
    return this.locations.list(tenantId, user);
  }

  @Get(':id')
  findOne(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Location> {
    return this.locations.findById(tenantId, id, user);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  create(@TenantId() tenantId: string, @Body() dto: CreateLocationDto): Promise<Location> {
    return this.locations.create(tenantId, dto);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN)
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
  ): Promise<Location> {
    return this.locations.update(tenantId, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@TenantId() tenantId: string, @Param('id') id: string): Promise<void> {
    await this.locations.delete(tenantId, id);
  }
}
