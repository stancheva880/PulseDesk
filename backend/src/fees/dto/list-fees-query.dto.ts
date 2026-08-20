import { FeeStatus } from '@prisma/client';
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';

/**
 * "Who still owes?" is one question, and a PARTIAL payer owes as much as an UNPAID one, so
 * the answer needs both. OUTSTANDING is that pair — deliberately widening this one filter
 * rather than adding a second, because a separate `outstanding` boolean would need
 * string-to-bool coercion and would then have to be reconciled with `status` on every
 * request. FeeStatus itself stays untouched: it describes a fee, not a query.
 */
export const OUTSTANDING = 'OUTSTANDING';
export const FEE_STATUS_FILTERS = [...Object.values(FeeStatus), OUTSTANDING] as const;
export type FeeStatusFilter = (typeof FEE_STATUS_FILTERS)[number];

export class ListFeesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(FEE_STATUS_FILTERS)
  status?: FeeStatusFilter;

  @IsOptional()
  @IsString()
  classId?: string;

  @IsOptional()
  @IsString()
  traineeId?: string;

  @IsOptional()
  @IsDateString()
  periodStartFrom?: string;

  @IsOptional()
  @IsDateString()
  periodStartTo?: string;
}
