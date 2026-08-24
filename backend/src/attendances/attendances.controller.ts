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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';
import { NoContent, ResponseSchema } from '@/common/response-schema';
import {
  AttendanceCandidatesSchema,
  AttendanceSchema,
  AttendanceWithTraineeListSchema,
  BulkMarkResultSchema,
  CustomerSessionEntryListSchema,
} from './attendances.schema';
import { AttendancesService } from './attendances.service';
import { AddAttendanceDto } from './dto/add-attendance.dto';
import { BulkMarkAttendancesDto } from './dto/bulk-mark-attendances.dto';
import { ListMySessionsQueryDto } from './dto/list-my-sessions-query.dto';
import { RsvpDto } from './dto/rsvp.dto';

@ApiBearerAuth()
@Controller()
export class AttendancesController {
  constructor(private readonly attendances: AttendancesService) {}

  /**
   * The trainees who can still be added to this session. Nested under the session because the
   * exclusion is a property of the session, and because the authorization is the session's — the
   * same @Roles pair and the same visibility check as the attendance list below. The rows
   * stay the PaginatedTrainee shape; TKT-0103 extends the envelope with `spotsLeft`.
   */
  @ApiOperation({ summary: 'List the trainees you can still add to this session, with the spots left.' })
  @Get('sessions/:sessionId/attendance-candidates')
  @Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
  @ResponseSchema('AttendanceCandidates', AttendanceCandidatesSchema)
  candidates(
    @TenantId() tenantId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.attendances.listCandidates(tenantId, sessionId, user, query);
  }

  @ApiOperation({ summary: 'List the attendance rows of one session.' })
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

  @ApiOperation({ summary: 'Add a trainee to a session. A prepaid visit is drawn if a card applies.' })
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

  // TKT-0113: unbooking — the visit returns via the consumption cascade, and on a
  // FIFO_AUTO class the freed spot books the queue head in the same transaction.
  @ApiOperation({ summary: 'Remove a booking. The visit returns and the queue head can get the spot.' })
  @Delete('sessions/:sessionId/attendances/:id')
  @Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema('AttendanceNoContent', NoContent)
  async remove(
    @TenantId() tenantId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.attendances.remove(tenantId, sessionId, user, id);
  }

  @ApiOperation({ summary: 'Mark the attendance of a whole session in one request.' })
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

  @ApiOperation({ summary: 'Record the reply of a customer for one session.' })
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

  @ApiOperation({ summary: 'List the sessions of the family, with bookings and queue positions.' })
  @Get('me/sessions')
  @Roles(UserRole.CUSTOMER)
  @ResponseSchema('CustomerSessionEntryList', CustomerSessionEntryListSchema)
  myUpcoming(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMySessionsQueryDto,
  ) {
    return this.attendances.listCustomerSessions(tenantId, user.id, query);
  }

  // TKT-0118: the customer booking door — same body and response as the staff add, gated by
  // the class's self-booking policy inside the service.
  @ApiOperation({ summary: 'Book a spot as a customer. Needs self-booking on the class.' })
  @Post('me/sessions/:sessionId/bookings')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.CREATED)
  @ResponseSchema('Attendance', AttendanceSchema)
  bookForCustomer(
    @TenantId() tenantId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddAttendanceDto,
  ) {
    return this.attendances.bookForCustomer(tenantId, sessionId, user, dto);
  }

  // TKT-0119: the customer cancel door — addressed by trainee, not attendance id, because
  // that is what the portal knows. The freed spot runs the same waitlist machinery as the
  // staff removal, and the card visit returns via the consumption cascade.
  @ApiOperation({ summary: 'Cancel a booking as a customer. The visit returns.' })
  @Delete('me/sessions/:sessionId/bookings/:traineeId')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema('AttendanceNoContent', NoContent)
  async cancelForCustomer(
    @TenantId() tenantId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('traineeId') traineeId: string,
  ): Promise<void> {
    await this.attendances.cancelForCustomer(tenantId, sessionId, user, traineeId);
  }
}
