import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const sourceDir = resolve('src/generated/postgres-client');
const targetDir = resolve('dist/generated/postgres-client');

await rm(targetDir, { recursive: true, force: true });
await mkdir(dirname(targetDir), { recursive: true });
await cp(sourceDir, targetDir, { recursive: true });
