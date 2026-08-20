import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';

export class ListClassesQueryDto extends PaginationQueryDto {
  /**
   * Query params arrive as strings, so `@Type(() => Boolean)` is the wrong tool here —
   * `Boolean('false')` is `true`, which would turn a request for retired classes into a request
   * for active ones. Mapping only the two literals leaves anything else a string, which
   * `@IsBoolean()` then rejects as a 400 rather than guessing.
   */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isActive?: boolean;

  /**
   * Substring match over the class name, for the trainee form's class picker (TKT-0080). Composes
   * with `isActive` rather than replacing it. Matched against four casings of the query, because
   * SQLite folds case for ASCII only.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
