import { loadEnv } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { connectMongo, disconnectMongo } from '../db/connect.js';
import { seedAll } from '../db/seed.js';

/** `npm run seed --workspace server` — idempotent catalogue + demo content. */
const env = loadEnv();
const logger = createLogger(env);

try {
  await connectMongo(env.MONGO_URI);
  const report = await seedAll(env.mediaDir);
  logger.info({ ...report, mediaDir: env.mediaDir }, report.skipped ? 'catalogue already seeded' : 'catalogue seeded');
  if (report.skipped) {
    process.stdout.write('[cadenza] catalogue already present — nothing to do.\n');
  } else {
    process.stdout.write(
      `[cadenza] seeded ${report.artists} artists, ${report.albums} albums, ${report.songs} songs, ` +
        `${report.users} demo users, ${report.playlists} playlists, ${report.rooms} room, ` +
        `${report.messages} messages, ${report.playEvents} play events.\n`,
    );
  }
  await disconnectMongo();
  process.exit(0);
} catch (error) {
  logger.error({ err: error instanceof Error ? error.message : String(error) }, 'seed failed');
  await disconnectMongo().catch(() => undefined);
  process.exit(1);
}
