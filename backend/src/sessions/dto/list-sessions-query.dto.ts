import { IsDateString, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';

export class ListSessionsQueryDto extends PaginationQueryDto {
  /** Inclusive lower bound on `startsAt`. */
  @IsOptional()
  @IsDateString()
  startsAtFrom?: string;

  /**
   * Exclusive upper bound on `startsAt` — hence `Before` rather than the `To` that
   * `ListFeesQueryDto` uses. Fees bound a calendar month, where an inclusive end is natural; a
   * session is an instant, and the callers that ask for "this week" need a half-open range or the
   * first session of the next week lands in both weeks.
   */
  @IsOptional()
  @IsDateString()
  startsAtBefore?: string;
}
