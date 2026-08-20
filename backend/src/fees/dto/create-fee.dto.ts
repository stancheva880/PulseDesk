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

export class CreateFeeDto {
  @IsString()
  classId!: string;

  @IsString()
  traineeId!: string;

  // YYYY-MM-DD or full ISO — class-validator's IsDateString accepts both.
  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_AMOUNT)
  @Max(MAX_AMOUNT)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
