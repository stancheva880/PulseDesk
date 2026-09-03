import { IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator';

// Every field is independently clearable: `null` removes it (the portal simply stops
// offering that method), `undefined`/omitted leaves it untouched, matching the
// bookingCutoffMin precedent in update-class.dto.ts. None are required together — a
// location can offer any subset of these, including none yet.
export class UpdateLocationPaymentDetailsDto {
  @IsOptional()
  @ValidateIf((o: UpdateLocationPaymentDetailsDto) => o.bankIban !== null)
  @IsString()
  @MaxLength(50)
  bankIban?: string | null;

  @IsOptional()
  @ValidateIf((o: UpdateLocationPaymentDetailsDto) => o.bankAccountHolder !== null)
  @IsString()
  @MaxLength(120)
  bankAccountHolder?: string | null;

  @IsOptional()
  @ValidateIf((o: UpdateLocationPaymentDetailsDto) => o.revolutHandle !== null)
  @IsString()
  @MaxLength(120)
  revolutHandle?: string | null;

  @IsOptional()
  @ValidateIf((o: UpdateLocationPaymentDetailsDto) => o.myposLink !== null)
  @IsUrl()
  @MaxLength(255)
  myposLink?: string | null;

  @IsOptional()
  @ValidateIf((o: UpdateLocationPaymentDetailsDto) => o.cashNote !== null)
  @IsString()
  @MaxLength(500)
  cashNote?: string | null;
}
