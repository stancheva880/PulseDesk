import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// Client-side compresses to a small square before upload (see profile page), so this cap is a
// safety ceiling, not a target — a couple hundred KB of base64 is already a generous avatar.
const MAX_AVATAR_LENGTH = 300_000;

// currentPassword is required only when email is present — enforced in the service, not here,
// since class-validator has no clean "required if another field is set" rule. Password itself
// has its own endpoint (PATCH /users/me/password); this one never touches passwordHash.
export class UpdateOwnProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  firstName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  lastName?: string | null;

  // Free text, deliberately unvalidated beyond the length — same as CreateUserDto.
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentPassword?: string;

  // A data: URI, not a file upload — no object storage in this stack (see schema.prisma).
  // null clears it back to the initials fallback the UI shows for no avatar.
  @IsOptional()
  @IsString()
  @MaxLength(MAX_AVATAR_LENGTH)
  @Matches(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/)
  avatarUrl?: string | null;
}
