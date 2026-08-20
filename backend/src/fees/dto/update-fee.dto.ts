import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_AMOUNT, MIN_AMOUNT } from '@/common/dto/money';

// classId/traineeId/sessionId are intentionally NOT updatable — moving a fee to a
// different (class, trainee, session) is semantically a "delete + create new" operation.
// The frontend should follow that flow.
export class UpdateFeeDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_AMOUNT)
  @Max(MAX_AMOUNT)
  amount?: number;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
