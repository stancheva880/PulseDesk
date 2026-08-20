import { UserRole } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';

export class ListUsersQueryDto extends PaginationQueryDto {
  /**
   * Membership role **in the acting tenant**. `User` carries no role column — the role lives on
   * `Membership` — so this narrows the same membership condition the list is already built on,
   * rather than adding a second one. Holding this role in another club does not match.
   */
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  /**
   * Substring match over email, first name and last name — for the pickers that used to download
   * the whole table. Bounded at 100 characters because a search box has no business sending more,
   * and each character costs four LIKE variants (see `searchVariants`).
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
