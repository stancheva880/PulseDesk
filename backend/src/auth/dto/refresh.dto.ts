import { IsOptional, IsString, MinLength } from 'class-validator';

export class RefreshDto {
  // Optional because browsers send the token as an httpOnly cookie and post no body at
  // all. The global ValidationPipe runs forbidNonWhitelisted, so a required field here
  // would 400 every cookie-based refresh. Non-browser callers still use the body.
  @IsOptional()
  @IsString()
  @MinLength(1)
  refreshToken?: string;
}
