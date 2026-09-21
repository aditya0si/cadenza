import { MongoMemoryServer, MongoBinary } from 'mongodb-memory-server';
import type { GlobalSetupContext } from 'vitest/node';

/**
 * Pins the mongod version so local runs and CI resolve the same binary, and
 * prints the resolved path + version as evidence in the test output.
 */
export const MONGOD_BINARY_VERSION = '8.2.6';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

export default async function globalSetup({ provide }: GlobalSetupContext): Promise<() => Promise<void>> {
  const started = Date.now();
  const binaryPath = await MongoBinary.getPath({ version: MONGOD_BINARY_VERSION });
  const server = await MongoMemoryServer.create({ binary: { version: MONGOD_BINARY_VERSION } });
  const uri = server.getUri();
  provide('mongoUri', uri);
  process.stdout.write(
    `\n[vitest] mongodb-memory-server ${MONGOD_BINARY_VERSION} ready in ${Date.now() - started} ms\n` +
      `[vitest] mongod binary: ${binaryPath}\n[vitest] uri: ${uri}\n\n`,
  );

  return async () => {
    await server.stop();
  };
}
