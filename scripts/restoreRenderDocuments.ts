import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const serviceId = process.env.RENDER_SERVICE_ID || 'srv-d8svkjj6sc1c73dvedug';
const defaultRoot = path.join(process.env.USERPROFILE || process.cwd(), 'Desktop', 'Adalberto');
const rootPath = path.resolve(process.argv.find((arg) => !arg.startsWith('--') && arg !== process.argv[0] && arg !== process.argv[1]) || defaultRoot);
const dryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Number.POSITIVE_INFINITY;
const allowedExtensions = new Set(['.pdf', '.docx', '.doc', '.jpg', '.jpeg', '.png']);

type RenderEnvVar = {
  envVar?: { key: string; value?: string };
  key?: string;
  value?: string;
};

type LocalFile = {
  path: string;
  fileName: string;
  sha256: string;
  size: number;
};

function readRenderApiKey() {
  const configPath = path.join(process.env.USERPROFILE || '', '.render', 'cli.yaml');
  return fs.readFile(configPath, 'utf8').then((content) => {
    const lines = content.split(/\r?\n/);
    const apiIndex = lines.findIndex((line) => line.trim() === 'api:');
    if (apiIndex < 0) throw new Error('Render CLI is not logged in');
    for (let index = apiIndex + 1; index < lines.length; index += 1) {
      if (/^\S/.test(lines[index])) break;
      const match = lines[index].match(/^\s+key:\s*(\S+)/);
      if (match) return match[1];
    }
    throw new Error('Render API key not found in CLI config');
  });
}

async function readRenderEnv() {
  const apiKey = await readRenderApiKey();
  const response = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars?limit=100`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`Render env request failed: ${response.status} ${await response.text()}`);
  const rows = (await response.json()) as RenderEnvVar[];
  const env = new Map<string, string>();
  for (const row of rows) {
    const key = row.envVar?.key ?? row.key;
    const value = row.envVar?.value ?? row.value;
    if (key && value !== undefined) env.set(key, value);
  }
  return env;
}

async function walkFiles(folder: string, output: string[] = []) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(fullPath, output);
      continue;
    }
    if (!entry.isFile() || entry.name.startsWith('~$')) continue;
    if (!allowedExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    output.push(fullPath);
  }
  return output;
}

async function fileHash(filePath: string) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function localFileInfo(filePath: string): Promise<LocalFile> {
  const stat = await fs.stat(filePath);
  return {
    path: filePath,
    fileName: path.basename(filePath),
    sha256: await fileHash(filePath),
    size: stat.size
  };
}

function basicAuth(username?: string, password?: string) {
  if (!username || !password) return undefined;
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function mimeTypeForFile(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (extension === '.doc') return 'application/msword';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

async function uploadFile(baseUrl: string, authHeader: string | undefined, documentId: string, file: LocalFile) {
  const buffer = await fs.readFile(file.path);
  const body = new FormData();
  body.append('file', new Blob([buffer], { type: mimeTypeForFile(file.fileName) }), file.fileName);
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/documents/${documentId}/restore-file`, {
    method: 'POST',
    headers: authHeader ? { Authorization: authHeader } : undefined,
    body
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
}

async function main() {
  const env = await readRenderEnv();
  const databaseUrl = env.get('DATABASE_URL') || process.env.DATABASE_URL;
  const publicBaseUrl = env.get('PUBLIC_BASE_URL') || 'https://fmh-gestion.onrender.com';
  if (!databaseUrl) throw new Error('DATABASE_URL is not available from Render env vars');
  process.env.DATABASE_URL = databaseUrl;

  const { PrismaClient } = await import('../src/generated/postgres-client/index.js');
  const prisma = new PrismaClient();
  const documents = await prisma.document.findMany({
    select: { id: true, fileName: true, sha256: true, storagePath: true }
  });

  const localPaths = await walkFiles(rootPath);
  const localFiles = [];
  for (const filePath of localPaths) {
    localFiles.push(await localFileInfo(filePath));
  }

  const byHash = new Map(localFiles.map((file) => [file.sha256, file]));
  const byName = new Map<string, LocalFile[]>();
  for (const file of localFiles) {
    const key = file.fileName.toLocaleLowerCase('es-AR');
    byName.set(key, [...(byName.get(key) || []), file]);
  }

  const authHeader = basicAuth(env.get('BASIC_AUTH_USERNAME'), env.get('BASIC_AUTH_PASSWORD'));
  let matched = 0;
  let uploaded = 0;
  let skipped = 0;

  for (const document of documents) {
    if ((dryRun ? matched : uploaded) >= limit) break;
    const hashMatch = document.sha256 ? byHash.get(document.sha256) : undefined;
    const nameMatches = byName.get(document.fileName.toLocaleLowerCase('es-AR')) || [];
    const file = hashMatch || (nameMatches.length === 1 ? nameMatches[0] : undefined);
    if (!file) {
      skipped += 1;
      continue;
    }

    matched += 1;
    if (dryRun) {
      console.log(`[dry-run] ${document.fileName} -> ${file.path}`);
      continue;
    }

    await uploadFile(publicBaseUrl, authHeader, document.id, file);
    uploaded += 1;
    console.log(`[uploaded] ${uploaded} ${document.fileName}`);
  }

  await prisma.$disconnect();
  console.log(JSON.stringify({ rootPath, localFiles: localFiles.length, documents: documents.length, matched, uploaded, skipped, dryRun }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
