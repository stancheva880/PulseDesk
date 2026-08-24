import { IsDateString, IsOptional, Matches } from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';

// The shape of every Prisma cuid this schema mints: 'c' + 20+ lowercase alphanumerics.
// A malformed id is a caller bug and 400s; a well-formed unknown id just matches nothing.
const CUID = /^c[a-z0-9]{20,}$/;

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

  /** Only sessions of this class (TKT-0100). */
  @IsOptional()
  @Matches(CUID, { message: 'classId must be a cuid' })
  classId?: string;

  /** Only sessions this trainer teaches — intersects an EMPLOYEE viewer's own narrowing. */
  @IsOptional()
  @Matches(CUID, { message: 'trainerId must be a cuid' })
  trainerId?: string;

  /** Only sessions at this location — intersects a scoped admin's location allowlist. */
  @IsOptional()
  @Matches(CUID, { message: 'locationId must be a cuid' })
  locationId?: string;
}
