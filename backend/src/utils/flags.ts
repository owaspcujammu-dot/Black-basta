import crypto from 'node:crypto';
import { config } from '../config';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** NIKA{...}: prefix, braces, and 1-200 printable non-space characters without braces. */
export const FLAG_REGEX = new RegExp(`^${escapeRegExp(config.flagPrefix)}\\{[^\\s{}]{1,200}\\}$`);
export const FLAG_FORMAT = `${config.flagPrefix}{...}`;

/**
 * Extra accepted flags may also contain spaces (e.g. "NIKA{Roronoa Zoro}" next to
 * "NIKA{Roronoa_Zoro}"), but no braces, tabs or line breaks.
 */
export const EXTRA_FLAG_REGEX = new RegExp(`^${escapeRegExp(config.flagPrefix)}\\{[^{}\\t\\r\\n]{1,200}\\}$`);

export function isWellFormedFlag(flag: string): boolean {
  return FLAG_REGEX.test(flag);
}

/** The form a flag is hashed and compared in: trimmed, and lower-cased for case-insensitive challenges. */
function normalizeFlag(flag: string, caseInsensitive: boolean): string {
  const trimmed = flag.trim();
  return caseInsensitive ? trimmed.toLowerCase() : trimmed;
}

/** A stored flag: its hash and salt. */
export interface FlagHash {
  flagHash: string;
  flagSalt: string;
}

/** Hashes a flag the way the challenge compares it. */
export function hashChallengeFlag(flag: string, caseInsensitive: boolean): FlagHash {
  const flagSalt = newFlagSalt();
  return { flagSalt, flagHash: hashFlag(normalizeFlag(flag, caseInsensitive), flagSalt) };
}

/**
 * Whether a submitted flag matches the main flag or any extra accepted flag.
 * Every stored hash is checked, so the time taken does not reveal which matched.
 */
export function matchesAnyFlag(candidate: string, caseInsensitive: boolean, flags: FlagHash[]): boolean {
  const normalized = normalizeFlag(candidate, caseInsensitive);
  let matched = false;
  for (const flag of flags) matched = verifyFlag(normalized, flag.flagSalt, flag.flagHash) || matched;
  return matched;
}

export function newFlagSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function hashFlag(flag: string, salt: string): string {
  return crypto.createHash('sha256').update(`${salt}:${flag}`, 'utf8').digest('hex');
}

/** Constant-time comparison: reveals nothing about how much of the flag matched. */
function verifyFlag(candidate: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashFlag(candidate, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
