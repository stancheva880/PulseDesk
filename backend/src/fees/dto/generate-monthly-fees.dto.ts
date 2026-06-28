import { IsDateString, IsOptional, IsString } from 'class-validator';

export class GenerateMonthlyFeesDto {
  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  // Optional — if omitted, generate for ALL PER_MONTH classes in the tenant.
  @IsOptional()
  @IsString()
  classId?: string;
}
