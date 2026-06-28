import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { AttendancesService } from './attendances.service';
import { AddAttendanceDto } from './dto/add-attendance.dto';
import { BulkMarkAttendancesDto } from './dto/bulk-mark-attendances.dto';
import { RsvpDto } from './dto/rsvp.dto';

@Controller()
export class AttendancesController {
  constructor(private readonly attendances: AttendancesService) {}

  @Get('sessions/:sessionId/attendances')
  @Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
  list(
    @TenantId() tenantId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attendances.listForSession(tenantId, sessionId, user);
  }

  @Post('sessions/:sessionId/attendances')
  @Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
  @HttpCode(HttpStatus.CREATED)
  addTrainee(
    @TenantId() tenantId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddAttendanceDto,
  ) {
    return this.attendances.addTrainee(tenantId, sessionId, user, dto);
  }

  @Put('sessions/:sessionId/attendances')
  @Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
  @HttpCode(HttpStatus.OK)
  bulkMark(
    @TenantId() tenantId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkMarkAttendancesDto,
  ) {
    return this.attendances.bulkMark(tenantId, sessionId, user, dto);
  }

  @Patch('sessions/:sessionId/rsvp')
  @Roles(UserRole.CUSTOMER)
  rsvp(
    @TenantId() tenantId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RsvpDto,
  ) {
    return this.attendances.rsvp(tenantId, sessionId, user, dto);
  }

  @Get('me/sessions')
  @Roles(UserRole.CUSTOMER)
  myUpcoming(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attendances.listCustomerSessions(tenantId, user.id);
  }
}
