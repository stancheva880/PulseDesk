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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';
import { ResponseSchema } from '@/common/response-schema';
import { PaginatedTraineeSchema } from '@/trainees/trainees.schema';
import {
  AttendanceSchema,
  AttendanceWithTraineeListSchema,
  BulkMarkResultSchema,
  CustomerSessionEntryListSchema,
} from './attendances.schema';
import { AttendancesService } from './attendances.service';
import { AddAttendanceDto } from './dto/add-attendance.dto';
import { BulkMarkAttendancesDto } from './dto/bulk-mark-attendances.dto';
import { RsvpDto } from './dto/rsvp.dto';

@ApiBearerAuth()
@Controller()
export class AttendancesController {
  constructor(private readonly attendances: AttendancesService) {}

  /**
   * The trainees who can still be added to this session. Nested under the session because the
   * exclusion is a property of the session, and because the authorization is the session's — the
   * same @Roles pair and the same visibility check as the attendance list below. Reuses
   * PaginatedTrainee: the rows are trainees, so a second schema for them would only drift.
   */
  @Get('sessions/:sessionId/attendance-candidates')
  @Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
  @ResponseSchema('PaginatedTrainee', PaginatedTraineeSchema)
  candidates(
    @TenantId() tenantId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.attendances.listCandidates(tenantId, sessionId, user, query);
  }

  @Get('sessions/:sessionId/attendances')
  @Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
  @ResponseSchema('AttendanceWithTraineeList', AttendanceWithTraineeListSchema)
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
  @ResponseSchema('Attendance', AttendanceSchema)
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
  @ResponseSchema('BulkMarkResult', BulkMarkResultSchema)
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
  @ResponseSchema('Attendance', AttendanceSchema)
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
  @ResponseSchema('CustomerSessionEntryList', CustomerSessionEntryListSchema)
  myUpcoming(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attendances.listCustomerSessions(tenantId, user.id);
  }
}
