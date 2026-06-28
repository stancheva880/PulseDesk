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
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { Roles } from '@/auth/decorators/roles.decorator';
import { TenantId } from '@/auth/decorators/tenant-id.decorator';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentsService } from './payments.service';

@Controller('fees/:feeId/payments')
@Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('feeId') feeId: string,
  ) {
    return this.payments.listForFee(tenantId, feeId, user);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  record(
    @TenantId() tenantId: string,
    @Param('feeId') feeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.payments.record(tenantId, feeId, user, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('feeId') feeId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.payments.delete(tenantId, feeId, id, user);
  }
}
