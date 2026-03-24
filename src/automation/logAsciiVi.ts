/**
 * Strip Vietnamese diacritics for log files / Windows console (avoids mojibake, easier to grep).
 * Safe to call multiple times (idempotent for already-ASCII text).
 */
export function logAsciiVi(text: string): string {
  if (!text) return text
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/\u0110/g, 'D')
}
