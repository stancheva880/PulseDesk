import { IsDateString, IsOptional, IsString } from 'class-validator';

// Generate concrete Sessions from active ClassSchedule rows.
// `from` and `to` are inclusive ISO date strings (YYYY-MM-DD).
export class GenerateSessionsDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  // Optional filter — only generate from this class's schedules.
  @IsOptional()
  @IsString()
  classId?: string;
}

export interface GenerateSessionsResult {
  created: number;
  skipped: number;
}
