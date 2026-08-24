import { IsDateString, IsOptional } from 'class-validator';

/**
 * TKT-0102: the portal calendar's visible window. Same half-open convention as
 * ListSessionsQueryDto — `from` inclusive, `to` exclusive — so a week never double-counts
 * the next week's first session. No pagination: a bounded window replaces the list cap.
 */
export class ListMySessionsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
