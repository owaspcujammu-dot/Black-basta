import { z } from 'zod';
import { config } from '../config';
import { EXTRA_FLAG_REGEX, FLAG_FORMAT, FLAG_REGEX } from './flags';

// bcrypt only considers the first 72 bytes of a password.
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(72, 'Password must be at most 72 characters.')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password is too long.')
  .refine((value) => /[a-z]/.test(value), 'Password needs a lowercase letter.')
  .refine((value) => /[A-Z]/.test(value), 'Password needs an uppercase letter.')
  .refine((value) => /\d/.test(value), 'Password needs a number.');

export const registerSchema = z
  .object({
    username: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.-]{3,24}$/, 'Username must be 3-24 characters: letters, numbers, dot, dash or underscore.'),
    fullName: z.string().trim().min(2, 'Full name is required.').max(80),
    email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
    password,
    confirmPassword: z.string(),
    teamName: z
      .string()
      .trim()
      .max(50)
      .optional()
      .transform((value) => (value ? value : undefined)),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });

/** A player's name inside a team: letters (any language), numbers, spaces and . ' - _ */
const playerName = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(1)
      .max(60, 'Player names can be at most 60 characters.')
      .regex(/^[\p{L}\p{N} .'_-]+$/u, "Player names may use letters, numbers, spaces and . ' - _"),
  );

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Team name is required.').max(254),
  password: z.string().min(1, 'Password is required.').max(200),
  /** Team logins: which team member is playing on this device. */
  player: z
    .union([playerName, z.literal('')])
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export const submitFlagSchema = z.object({
  flag: z.string().max(500),
});

const hintInput = z.object({
  id: z.number().int().positive().optional(),
  content: z.string().trim().min(1, 'Hint text is required.').max(2000),
  cost: z.coerce.number().int().min(0).max(10_000).default(0),
});

const challengeBase = {
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(1).max(10_000),
  categoryId: z.coerce.number().int().positive(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD', 'INSANE']),
  points: z.coerce.number().int().min(0).max(10_000),
  enabled: z.boolean().default(true),
  hints: z.array(hintInput).max(10).default([]),
  /** DYNAMIC: `points` is the starting value; it drops to `minimumPoints` over `decay` solves. */
  scoring: z.enum(['STATIC', 'DYNAMIC']).default('STATIC'),
  minimumPoints: z.coerce.number().int().min(0).max(10_000).nullish(),
  decay: z.coerce.number().int().min(1, 'Decay must be at least 1 solve.').max(10_000).nullish(),
  /** Practice challenge: open at any time, never scored. */
  practice: z.boolean().default(false),
  /** Compare flags (main and extra) ignoring capitals. */
  flagCaseInsensitive: z.boolean().default(false),
  /** Further accepted flags (may contain spaces). Omitted on update: keep the current ones. */
  extraFlags: z
    .array(z.string().trim().regex(EXTRA_FLAG_REGEX, `Each extra flag must look like ${FLAG_FORMAT} (spaces are allowed).`))
    .max(20, 'At most 20 extra flags.')
    .optional(),
};

/** A dynamic challenge needs a minimum no higher than its starting value, and a decay. */
function checkScoring(data: { scoring: 'STATIC' | 'DYNAMIC'; points: number; minimumPoints?: number | null; decay?: number | null }, ctx: z.RefinementCtx) {
  if (data.scoring !== 'DYNAMIC') return;
  if (data.minimumPoints == null) ctx.addIssue({ code: 'custom', path: ['minimumPoints'], message: 'Set the minimum value for a dynamic challenge.' });
  else if (data.minimumPoints > data.points) ctx.addIssue({ code: 'custom', path: ['minimumPoints'], message: 'The minimum cannot be higher than the starting value.' });
  if (data.decay == null) ctx.addIssue({ code: 'custom', path: ['decay'], message: 'Set after how many solves the value reaches the minimum.' });
}

const flag = z.string().trim().regex(FLAG_REGEX, `Flag must use the format ${FLAG_FORMAT}`);

export const createChallengeSchema = z.object({ ...challengeBase, flag }).superRefine(checkScoring);

export const updateChallengeSchema = z.object({
  ...challengeBase,
  // Blank keeps the current flag (the stored flag can never be read back).
  flag: z
    .union([flag, z.literal('')])
    .optional()
    .transform((value) => (value ? value : undefined)),
}).superRefine(checkScoring);

const adminPassword = z
  .string()
  .min(8, 'Passwords must be at least 8 characters.')
  .max(72, 'Passwords must be at most 72 characters.')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password is too long.');

/** Player names on a team: letters (any language), numbers, spaces and . ' - _ */
// Team member names follow exactly the same rules as the player name typed at login.
const memberName = playerName;

const members = z
  .array(memberName)
  .max(config.maxTeamSize, `A team can have at most ${config.maxTeamSize} players.`)
  .refine((list) => new Set(list.map((name) => name.toLowerCase())).size === list.length, 'The same member is listed twice.');

export const updateUserSchema = z
  .object({
    disabled: z.boolean().optional(),
    resetPassword: z.literal(true).optional(),
    /** With resetPassword: the organizer's chosen password instead of a generated one. */
    password: z
      .union([adminPassword, z.literal('')])
      .optional()
      .transform((value) => (value ? value : undefined)),
    /** Log the account out on every device. */
    signOutEverywhere: z.literal(true).optional(),
    /** Replace the team's member list. */
    members: members.optional(),
  })
  .refine(
    (data) => data.disabled !== undefined || data.resetPassword || data.signOutEverywhere || data.members !== undefined,
    'Nothing to update.',
  );

/** Team names: letters (any language), numbers, spaces and . _ ' & ! - ; stored trimmed with single spaces. */
const teamName = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(2, 'Team names need at least 2 characters.')
      .max(32, 'Team names can be at most 32 characters.')
      .regex(/^[\p{L}\p{N} ._'&!-]+$/u, "Team names may use letters, numbers, spaces and . _ ' & ! -"),
  );

export const createTeamsSchema = z.object({
  teams: z
    .array(
      z.object({
        name: teamName,
        password: z
          .union([adminPassword, z.literal('')])
          .optional()
          .transform((value) => (value ? value : undefined)),
        email: z
          .union([z.string().trim().toLowerCase().email('Enter a valid email address.').max(254), z.literal('')])
          .optional()
          .transform((value) => (value ? value : undefined)),
        members: members.default([]),
      }),
    )
    .min(1, 'Add at least one team.')
    .max(200, 'At most 200 teams at a time.'),
});

export const eventActionSchema = z.object({
  action: z.enum(['start', 'pause', 'end', 'reset']),
});

const optionalDate = z
  .union([z.string().datetime({ offset: true }), z.literal(''), z.null()])
  .optional()
  .transform((value) => (value ? new Date(value) : value === undefined ? undefined : null));

export const eventScheduleSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  startsAt: optionalDate,
  endsAt: optionalDate,
  /** Scoreboard freeze; null reveals the live scoreboard. */
  freezeAt: optionalDate,
});

export const announcementSchema = z.object({
  title: z.string().trim().min(2).max(120),
  message: z.string().trim().min(1).max(4000),
});

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(80).optional(),
});
