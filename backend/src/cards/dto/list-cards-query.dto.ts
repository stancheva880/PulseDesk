import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination-query.dto';

export class ListCardsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  traineeId?: string;
}
