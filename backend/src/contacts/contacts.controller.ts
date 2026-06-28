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
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

@Controller('trainees/:traineeId/contacts')
@Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('traineeId') traineeId: string,
  ) {
    return this.contacts.list(tenantId, traineeId, user);
  }

  @Get(':id')
  findOne(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('traineeId') traineeId: string,
    @Param('id') id: string,
  ) {
    return this.contacts.findById(tenantId, traineeId, id, user);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('traineeId') traineeId: string,
    @Body() dto: CreateContactDto,
  ) {
    return this.contacts.create(tenantId, traineeId, dto, user);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('traineeId') traineeId: string,
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contacts.update(tenantId, traineeId, id, dto, user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('traineeId') traineeId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.contacts.delete(tenantId, traineeId, id, user);
  }
}
