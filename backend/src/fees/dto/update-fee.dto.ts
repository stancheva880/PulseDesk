import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

// classId/traineeId/sessionId are intentionally NOT updatable — moving a fee to a
// different (class, trainee, session) is semantically a "delete + create new" operation.
// The frontend should follow that flow.
export class UpdateFeeDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
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
