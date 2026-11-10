import bcrypt from 'bcrypt';
import { config } from '../config';
import { prisma } from '../db';
import { hashFlag, newFlagSalt } from '../utils/flags';
import { sealSecret } from '../utils/secrets';
import { slugify } from '../utils/text';
import { ACHIEVEMENTS } from './achievement.service';
import { getEvent, resetEventCache } from './event.service';

export const CATEGORIES = [
  'Web',
  'Cryptography',
  'Reverse Engineering',
  'Forensics',
  'OSINT',
  'Pwn',
  'Misc',
  'Mobile',
  'Cloud',
  'Steganography',
  // Welcome / sanity flags. Added late so existing category ids never change,
  // but listed first (see CATEGORY_SORT_FIRST).
  'Welcome',
  // Post-event feedback flags; listed last.
  'Feedback',
];

/** Categories shown before all others, regardless of their place in CATEGORIES. */
const CATEGORY_SORT_FIRST = new Set(['Welcome']);

/**
 * DEMO challenges with DEMO flags. These flags are public (they are in the
 * repository) — replace or delete every one of them before a real event.
 */
const DEMO_CHALLENGES = [
  {
    title: 'The Lost Log',
    category: 'Forensics',
    difficulty: 'MEDIUM',
    points: 250,
    flag: 'NIKA{demo_forensics_flag}',
    description:
      'A mysterious log was recovered from a damaged ship.\nSomething valuable is hidden inside.\nCan you recover it?\n\n[DEMO CHALLENGE — demo flag: NIKA{demo_forensics_flag}]',
    hints: [{ content: 'The captain always leaves clues in hexadecimal.', cost: 25 }],
  },
  {
    title: 'Devil Fruit Cipher',
    category: 'Cryptography',
    difficulty: 'EASY',
    points: 100,
    flag: 'NIKA{demo_crypto_flag}',
    description:
      'A scrap of parchment carries a message scrambled by a strange power.\nEvery letter has been shifted by the same amount.\n\n[DEMO CHALLENGE — demo flag: NIKA{demo_crypto_flag}]',
    hints: [{ content: 'A Roman emperor would recognise this cipher.', cost: 0 }],
  },
  {
    title: "Marine's Web",
    category: 'Web',
    difficulty: 'MEDIUM',
    points: 200,
    flag: 'NIKA{demo_web_flag}',
    description:
      'The Marines run an internal portal for bounty records.\nTheir login form trusts its visitors a little too much.\n\n[DEMO CHALLENGE — demo flag: NIKA{demo_web_flag}]',
    hints: [{ content: 'What happens when the username contains a quote?', cost: 20 }],
  },
  {
    title: 'Inside the Going Merry',
    category: 'Reverse Engineering',
    difficulty: 'HARD',
    points: 300,
    flag: 'NIKA{demo_reverse_flag}',
    description:
      "The ship's navigation binary asks for a password before it reveals the route.\nTake it apart and find what it compares against.\n\n[DEMO CHALLENGE — demo flag: NIKA{demo_reverse_flag}]",
    hints: [{ content: 'Strings are a good place to start; the check is a simple XOR.', cost: 30 }],
  },
  {
    title: 'Poneglyph',
    category: 'OSINT',
    difficulty: 'EASY',
    points: 100,
    flag: 'NIKA{demo_osint_flag}',
    description:
      'An ancient stone was photographed somewhere along the coast.\nFind where the picture was taken.\n\n[DEMO CHALLENGE — demo flag: NIKA{demo_osint_flag}]',
    hints: [],
  },
  {
    title: 'Den Den Mushi',
    category: 'Misc',
    difficulty: 'EASY',
    points: 100,
    flag: 'NIKA{demo_misc_flag}',
    description:
      'A snail transmitter keeps repeating the same beeps: short, long, short...\nDecode the transmission.\n\n[DEMO CHALLENGE — demo flag: NIKA{demo_misc_flag}]',
    hints: [{ content: 'Dots and dashes.', cost: 0 }],
  },
  {
    title: "Blackbeard's Secret",
    category: 'Steganography',
    difficulty: 'HARD',
    points: 300,
    flag: 'NIKA{demo_stego_flag}',
    description:
      'A portrait hangs in the captain’s cabin. It looks ordinary —\nbut the least significant details tell another story.\n\n[DEMO CHALLENGE — demo flag: NIKA{demo_stego_flag}]',
    hints: [{ content: 'Look at the lowest bit of each colour channel.', cost: 40 }],
  },
  {
    title: 'Ancient Weapon',
    category: 'Mobile',
    difficulty: 'INSANE',
    points: 500,
    flag: 'NIKA{demo_mobile_flag}',
    description:
      'An APK claims to control a weapon of legend, but it refuses to run on a rooted device.\nBypass its checks and extract the launch code.\n\n[DEMO CHALLENGE — demo flag: NIKA{demo_mobile_flag}]',
    hints: [{ content: 'The root check lives in native code. Hook it.', cost: 50 }],
  },
] as const;

/** Reference data the platform cannot run without. Idempotent; safe on every boot. */
export async function ensureBaseData(): Promise<void> {
  resetEventCache();
  await getEvent();

  await prisma.category.createMany({
    data: CATEGORIES.map((name, index) => ({ name, slug: slugify(name), sortOrder: CATEGORY_SORT_FIRST.has(name) ? -1 : index })),
    skipDuplicates: true,
  });
  await prisma.achievement.createMany({ data: ACHIEVEMENTS.map((achievement) => ({ ...achievement })), skipDuplicates: true });
}

/**
 * Creates (or re-keys) the admin account from ADMIN_USERNAME / ADMIN_PASSWORD.
 * The password only ever comes from the environment — there is no default.
 */
export async function seedAdmin(password: string | null = config.adminPassword): Promise<'created' | 'updated' | 'unchanged' | 'skipped'> {
  if (!password) return 'skipped';
  const usernameKey = config.adminUsername.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { usernameKey } });

  if (!existing) {
    await prisma.user.create({
      data: {
        username: config.adminUsername,
        usernameKey,
        fullName: 'Fleet Admiral',
        email: config.adminEmail,
        role: 'admin',
        passwordHash: await bcrypt.hash(password, config.bcryptRounds),
      },
    });
    return 'created';
  }
  if (existing.role !== 'admin') {
    throw new Error(`ADMIN_USERNAME "${config.adminUsername}" is already taken by a participant account.`);
  }
  // ADMIN_EMAIL is the source of truth for the admin's email, like ADMIN_PASSWORD for the password.
  if (existing.email !== config.adminEmail) {
    const clash = await prisma.user.findUnique({ where: { email: config.adminEmail }, select: { id: true } });
    if (clash && clash.id !== existing.id) {
      throw new Error(`ADMIN_EMAIL "${config.adminEmail}" is already used by another account.`);
    }
    await prisma.user.update({ where: { id: existing.id }, data: { email: config.adminEmail } });
  }
  if (await bcrypt.compare(password, existing.passwordHash)) return 'unchanged';

  await prisma.user.update({
    where: { id: existing.id },
    data: { passwordHash: await bcrypt.hash(password, config.bcryptRounds), tokenVersion: { increment: 1 } },
  });
  return 'updated';
}

/**
 * Seeds the eight sample challenges when the challenge table is empty.
 * Opt-in: only called when SEED_DEMO_CHALLENGES=true.
 * In production they are created DISABLED so demo flags can never go live by accident.
 */
export async function seedDemoChallenges(): Promise<number> {
  if ((await prisma.challenge.count()) > 0) return 0;
  const categories = new Map((await prisma.category.findMany()).map((category) => [category.name, category.id]));

  for (const demo of DEMO_CHALLENGES) {
    const salt = newFlagSalt();
    await prisma.challenge.create({
      data: {
        title: demo.title,
        slug: slugify(demo.title),
        description: demo.description,
        categoryId: categories.get(demo.category)!,
        difficulty: demo.difficulty,
        points: demo.points,
        flagSalt: salt,
        flagHash: hashFlag(demo.flag, salt),
        flagSecret: sealSecret(demo.flag),
        enabled: !config.isProduction,
        hints: { create: demo.hints.map((hint, index) => ({ ...hint, sortOrder: index })) },
      },
    });
  }
  return DEMO_CHALLENGES.length;
}

/**
 * Demo mode only: makes sure there is an admin and a "demo" participant to log
 * in with. It creates no other content — no sample pirates, solves or
 * announcements — so a demo instance starts as clean as a real one.
 * (Sample challenges are opt-in through SEED_DEMO_CHALLENGES=true.)
 */
export async function seedDemoAccounts(passwords: { admin: string; participant: string }): Promise<void> {
  await seedAdmin(passwords.admin);
  if (config.seedDemoChallenges) await seedDemoChallenges();

  const passwordHash = await bcrypt.hash(passwords.participant, config.bcryptRounds);
  const existing = await prisma.user.findUnique({ where: { usernameKey: 'demo' } });

  if (existing) {
    // Keep the password in step with DEMO_PASSWORD (or this run's generated one).
    if (!(await bcrypt.compare(passwords.participant, existing.passwordHash))) {
      await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, tokenVersion: { increment: 1 } } });
    }
    return;
  }

  const highest = await prisma.user.aggregate({ _max: { participantNumber: true } });
  await prisma.user.create({
    data: {
      username: 'demo',
      usernameKey: 'demo',
      fullName: 'Demo Pirate',
      email: 'demo@demo.blackbasta.local',
      passwordHash,
      participantNumber: (highest._max.participantNumber ?? 0) + 1,
    },
  });
}
