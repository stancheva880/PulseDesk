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
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentListSchema, PaymentSchema } from './payments.schema';
import { PaymentsService } from './payments.service';

@ApiBearerAuth()
@Controller('fees/:feeId/payments')
@Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @ApiOperation({ summary: 'List the payments recorded on one fee.' })
  @Get()
  @ResponseSchema('PaymentList', PaymentListSchema)
  list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('feeId') feeId: string,
  ) {
    return this.payments.listForFee(tenantId, feeId, user);
  }

  @ApiOperation({ summary: 'Record a payment. Refused above the balance that is due.' })
  @Post()
  @Roles(UserRole.ADMIN)
  @ResponseSchema('Payment', PaymentSchema)
  record(
    @TenantId() tenantId: string,
    @Param('feeId') feeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.payments.record(tenantId, feeId, user, dto);
  }

  @ApiOperation({ summary: 'Delete a payment entered by mistake. The fee status is set again.' })
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema('PaymentNoContent', NoContent)
  async remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('feeId') feeId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.payments.delete(tenantId, feeId, id, user);
  }
}
