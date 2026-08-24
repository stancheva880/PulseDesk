import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { NoContent, ResponseSchema } from '@/common/response-schema';
import { CreateRefundDto } from './dto/create-refund.dto';
import { RefundListSchema, RefundSchema } from './refunds.schema';
import { RefundsService } from './refunds.service';

@ApiBearerAuth()
@Controller('fees/:feeId/refunds')
@Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @ApiOperation({ summary: 'List the refunds recorded on one fee.' })
  @Get()
  @ResponseSchema('RefundList', RefundListSchema)
  list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('feeId') feeId: string,
  ) {
    return this.refunds.listForFee(tenantId, feeId, user);
  }

  @ApiOperation({ summary: 'Record money given back. Refused above the net amount paid.' })
  @Post()
  @Roles(UserRole.ADMIN)
  @ResponseSchema('Refund', RefundSchema)
  record(
    @TenantId() tenantId: string,
    @Param('feeId') feeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRefundDto,
  ) {
    return this.refunds.record(tenantId, feeId, user, dto);
  }

  @ApiOperation({ summary: 'Delete a refund entered by mistake. The fee status is set again.' })
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema('RefundNoContent', NoContent)
  async remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('feeId') feeId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.refunds.delete(tenantId, feeId, id, user);
  }
}
