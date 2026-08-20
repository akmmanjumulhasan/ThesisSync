import { randomInt } from "crypto";

/**
 * Common workflow: Admin role & access management.
 * Pure helpers, kept separate from the routes so the generation and
 * self-lockout rules can be reasoned about without a database.
 */

// Excludes visually ambiguous characters (0/O, 1/l/I) since this is read off
// a screen by an admin and typed or forwarded to whoever's account it is.
const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";

/** A random one-time password an admin can hand to a locked-out user. */
export function generateTempPassword(length = 12): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return out;
}
