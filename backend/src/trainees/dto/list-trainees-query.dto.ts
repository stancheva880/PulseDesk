import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';

export class ListTraineesQueryDto extends PaginationQueryDto {
  /**
   * Substring match over email, first name and last name, for the roster picker (TKT-0079). Same
   * contract as `GET /users?search` — the query is matched against four casings of itself, because
   * SQLite folds case for ASCII only. Bounded at 100 characters.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
