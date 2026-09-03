import { IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator';

// Mirrors locations/dto/update-location-payment-details.dto.ts exactly — same fields, same
// null-clears/undefined-leaves-untouched rule — for the club's shared default instead of one
// location's override.
export class UpdateTenantPaymentDetailsDto {
  @IsOptional()
  @ValidateIf((o: UpdateTenantPaymentDetailsDto) => o.bankIban !== null)
  @IsString()
  @MaxLength(50)
  bankIban?: string | null;

  @IsOptional()
  @ValidateIf((o: UpdateTenantPaymentDetailsDto) => o.bankAccountHolder !== null)
  @IsString()
  @MaxLength(120)
  bankAccountHolder?: string | null;

  @IsOptional()
  @ValidateIf((o: UpdateTenantPaymentDetailsDto) => o.revolutHandle !== null)
  @IsString()
  @MaxLength(120)
  revolutHandle?: string | null;

  @IsOptional()
  @ValidateIf((o: UpdateTenantPaymentDetailsDto) => o.myposLink !== null)
  @IsUrl()
  @MaxLength(255)
  myposLink?: string | null;

  @IsOptional()
  @ValidateIf((o: UpdateTenantPaymentDetailsDto) => o.cashNote !== null)
  @IsString()
  @MaxLength(500)
  cashNote?: string | null;
}
