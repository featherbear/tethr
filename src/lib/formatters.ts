/**
 * Format CCAPI exposure compensation values for display.
 *
 * CCAPI format examples:
 *   "+0.0"     → null (hide zero)
 *   "+3.0"     → "+3"
 *   "-2.0"     → "-2"
 *   "+0_1/3"   → "+1/3"
 *   "-0_1/3"   → "-1/3"
 *   "+1_1/3"   → "+1 1/3"
 *   "-2_2/3"   → "-2 2/3"
 */
export function formatExposure(raw: string | null): string | null {
  if (!raw) return null;

  const sign = raw.startsWith('-') ? '-' : '+';
  const abs = raw.replace(/^[+-]/, '');

  // Pure integer like "0.0", "3.0", "2.0"
  const intMatch = abs.match(/^(\d+)\.0$/);
  if (intMatch) {
    const n = parseInt(intMatch[1], 10);
    if (n === 0) return null; // hide zero
    return `${sign}${n}`;
  }

  // Fraction with whole part: "1_1/3", "2_2/3"
  const mixedMatch = abs.match(/^(\d+)_(\d+\/\d+)$/);
  if (mixedMatch) {
    const whole = parseInt(mixedMatch[1], 10);
    const frac = mixedMatch[2];
    if (whole === 0) return `${sign}${frac}`;        // "+1/3"
    return `${sign}${whole}·${frac}`;               // "+1·1/3"
  }

  // Bare fraction (shouldn't happen but just in case)
  if (abs.includes('/')) return `${sign}${abs}`;

  return raw; // fallback — return as-is
}
