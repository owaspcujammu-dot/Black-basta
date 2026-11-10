/**
 * Moves challenges between databases (e.g. this PC's demo database -> the
 * production server), including hints, attachments and the flag hashes, so
 * flags keep working without ever being written out in plain text.
 *
 *   Export:  tsx src/tools/challenges-transfer.ts export <folder>
 *   Import:  tsx src/tools/challenges-transfer.ts import <folder>
 *            (in the Docker image: node dist/src/tools/challenges-transfer.js import <folder>)
 *
 * The database is the one in DATABASE_URL. The embedded demo database can only
 * be opened by one process, so stop `npm run demo` / `npm run dev` before exporting.
 *
 * The export folder contains flag hashes: keep it private and delete it after use.
 * Admin-viewable flag copies travel sealed; they open on the target only when it uses
 * the same ADMIN_SECRETS_KEY (or JWT_SECRET) — otherwise re-enter the flags there once.
 * Import skips challenges whose slug already exists, so it is safe to re-run.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { closeDb, initDb, prisma } from '../db';
import { ensureBaseData } from '../services/seed.service';
import { challengeUploadDir } from '../services/upload.service';

const FORMAT = 'black-basta-challenges/1';

interface ExportedChallenge {
  title: string;
  slug: string;
  description: string;
  category: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'INSANE';
  points: number;
  /** Absent in exports made before dynamic scoring existed (= STATIC). */
  scoring?: 'STATIC' | 'DYNAMIC';
  minimumPoints?: number | null;
  decay?: number | null;
  enabled: boolean;
  flagHash: string;
  flagSalt: string;
  /** Absent in older exports. */
  flagCaseInsensitive?: boolean;
  extraFlags?: { flagHash: string; flagSalt: string; secret?: string | null }[];
  /** Admin-viewable sealed copy (absent in older exports). */
  flagSecret?: string | null;
  practice?: boolean;
  hints: { content: string; cost: number; sortOrder: number }[];
  attachments: { originalName: string; file: string; size: number }[];
}

async function exportTo(folder: string) {
  const files = path.join(folder, 'files');
  fs.mkdirSync(files, { recursive: true });

  const challenges = await prisma.challenge.findMany({
    orderBy: { id: 'asc' },
    include: { category: true, hints: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }, attachments: { orderBy: { id: 'asc' } }, extraFlags: { orderBy: { id: 'asc' } } },
  });

  const out: ExportedChallenge[] = [];
  for (const challenge of challenges) {
    const attachments: ExportedChallenge['attachments'] = [];
    for (const attachment of challenge.attachments) {
      const source = path.join(challengeUploadDir(challenge.id), attachment.storedName);
      if (!fs.existsSync(source)) {
        console.warn(`  ! ${challenge.title}: file ${attachment.originalName} is missing on disk — skipped`);
        continue;
      }
      fs.copyFileSync(source, path.join(files, attachment.storedName));
      attachments.push({ originalName: attachment.originalName, file: attachment.storedName, size: attachment.size });
    }
    out.push({
      title: challenge.title,
      slug: challenge.slug,
      description: challenge.description,
      category: challenge.category.name,
      difficulty: challenge.difficulty,
      points: challenge.points,
      scoring: challenge.scoring,
      minimumPoints: challenge.minimumPoints,
      decay: challenge.decay,
      enabled: challenge.enabled,
      flagHash: challenge.flagHash,
      flagSalt: challenge.flagSalt,
      flagCaseInsensitive: challenge.flagCaseInsensitive,
      flagSecret: challenge.flagSecret,
      extraFlags: challenge.extraFlags.map((extra) => ({ flagHash: extra.flagHash, flagSalt: extra.flagSalt, secret: extra.secret })),
      practice: challenge.practice,
      hints: challenge.hints.map((hint) => ({ content: hint.content, cost: hint.cost, sortOrder: hint.sortOrder })),
      attachments,
    });
    console.log(`  exported  ${challenge.title} (${attachments.length} file${attachments.length === 1 ? '' : 's'})`);
  }

  fs.writeFileSync(path.join(folder, 'challenges.json'), JSON.stringify({ format: FORMAT, exportedAt: new Date().toISOString(), challenges: out }, null, 2));
  console.log(`\n${out.length} challenge(s) exported to ${folder}`);
  console.log('This folder contains flag hashes — keep it private and delete it after importing.');
}

async function importFrom(folder: string) {
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'challenges.json'), 'utf8')) as { format: string; challenges: ExportedChallenge[] };
  if (manifest.format !== FORMAT) throw new Error(`Unknown export format "${manifest.format}".`);

  await ensureBaseData();
  const categories = new Map((await prisma.category.findMany()).map((category) => [category.name, category.id]));
  let added = 0;

  for (const item of manifest.challenges) {
    if (await prisma.challenge.findUnique({ where: { slug: item.slug }, select: { id: true } })) {
      console.log(`  skipped   ${item.title} (already exists)`);
      continue;
    }
    const categoryId = categories.get(item.category);
    if (!categoryId) throw new Error(`${item.title}: unknown category "${item.category}".`);
    for (const attachment of item.attachments) {
      if (!fs.existsSync(path.join(folder, 'files', attachment.file))) throw new Error(`${item.title}: file ${attachment.file} is missing from the export.`);
    }

    const created = await prisma.challenge.create({
      data: {
        title: item.title,
        slug: item.slug,
        description: item.description,
        categoryId,
        difficulty: item.difficulty,
        points: item.points,
        scoring: item.scoring ?? 'STATIC',
        minimumPoints: item.minimumPoints ?? null,
        decay: item.decay ?? null,
        enabled: item.enabled,
        flagHash: item.flagHash,
        flagSalt: item.flagSalt,
        flagCaseInsensitive: item.flagCaseInsensitive ?? false,
        flagSecret: item.flagSecret ?? null,
        extraFlags: { create: (item.extraFlags ?? []).map((extra) => ({ flagHash: extra.flagHash, flagSalt: extra.flagSalt, secret: extra.secret ?? null })) },
        practice: item.practice ?? false,
        hints: { create: item.hints },
      },
    });

    const directory = challengeUploadDir(created.id);
    fs.mkdirSync(directory, { recursive: true });
    for (const attachment of item.attachments) {
      // Keep the random stored name unless it is somehow already taken.
      const taken = await prisma.attachment.findUnique({ where: { storedName: attachment.file }, select: { id: true } });
      const storedName = taken ? `${crypto.randomBytes(8).toString('hex')}${path.extname(attachment.file)}` : attachment.file;
      fs.copyFileSync(path.join(folder, 'files', attachment.file), path.join(directory, storedName));
      await prisma.attachment.create({ data: { challengeId: created.id, originalName: attachment.originalName, storedName, size: attachment.size } });
    }
    added++;
    console.log(`  imported  ${item.title} (${item.attachments.length} file${item.attachments.length === 1 ? '' : 's'}${item.enabled ? '' : ', disabled'})`);
  }
  console.log(`\n${added} challenge(s) imported, ${manifest.challenges.length - added} skipped.`);
}

async function main() {
  const [command, folderArg] = process.argv.slice(2);
  if (!['export', 'import'].includes(command ?? '') || !folderArg) {
    console.error('Usage: challenges-transfer <export|import> <folder>');
    process.exit(2);
  }
  const folder = path.resolve(folderArg);
  await initDb();
  try {
    if (command === 'export') await exportTo(folder);
    else await importFrom(folder);
  } finally {
    await closeDb();
  }
}

main().catch((error) => {
  console.error(`\n[transfer failed] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
