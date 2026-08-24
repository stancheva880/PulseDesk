import { IsOptional, IsString } from 'class-validator';

/** TKT-0110: the class carries its own period and price — only the filter is an input. */
export class GenerateCourseFeesDto {
  @IsOptional()
  @IsString()
  classId?: string;
}
