import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateFeeDto {
  @IsString()
  classId!: string;

  @IsString()
  traineeId!: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  // YYYY-MM-DD or full ISO — class-validator's IsDateString accepts both.
  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
