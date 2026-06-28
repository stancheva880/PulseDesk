// Mirrors backend/src/common/age.ts — kept identical so the form's "show contacts"
// gate matches the backend's <18 validation exactly.
export function calculateAge(dateOfBirth: Date, on: Date = new Date()): number {
  let age = on.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = on.getMonth() - dateOfBirth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && on.getDate() < dateOfBirth.getDate())) {
    age--;
  }
  return age;
}

// Returns true when the DOB string is valid AND the person is under 18.
// Empty / unparseable input returns false (no contacts section shown until DOB is valid).
export function isMinor(dateOfBirthIso: string, on: Date = new Date()): boolean {
  if (!dateOfBirthIso) return false;
  const dob = new Date(dateOfBirthIso);
  if (Number.isNaN(dob.getTime())) return false;
  return calculateAge(dob, on) < 18;
}
