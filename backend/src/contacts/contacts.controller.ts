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
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { NoContent, ResponseSchema } from '@/common/response-schema';
import { ContactPersonListSchema, ContactPersonSchema } from './contacts.schema';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

@ApiBearerAuth()
@Controller('trainees/:traineeId/contacts')
@Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @ApiOperation({ summary: 'List the contacts of one trainee.' })
  @Get()
  @ResponseSchema('ContactPersonList', ContactPersonListSchema)
  list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('traineeId') traineeId: string,
  ) {
    return this.contacts.list(tenantId, traineeId, user);
  }

  @ApiOperation({ summary: 'Add a contact to one trainee.' })
  @Post()
  @Roles(UserRole.ADMIN)
  @ResponseSchema('ContactPerson', ContactPersonSchema)
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('traineeId') traineeId: string,
    @Body() dto: CreateContactDto,
  ) {
    return this.contacts.create(tenantId, traineeId, dto, user);
  }

  @ApiOperation({ summary: 'Change one contact of one trainee.' })
  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ResponseSchema('ContactPerson', ContactPersonSchema)
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('traineeId') traineeId: string,
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contacts.update(tenantId, traineeId, id, dto, user);
  }

  @ApiOperation({ summary: 'Delete one contact of one trainee.' })
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema('ContactNoContent', NoContent)
  async remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('traineeId') traineeId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.contacts.delete(tenantId, traineeId, id, user);
  }
}
