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

export class CreateRefundDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_AMOUNT)
  @Max(MAX_AMOUNT)
  amount!: number;

  @IsDateString()
  refundedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
