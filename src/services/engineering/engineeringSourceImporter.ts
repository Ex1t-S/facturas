import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.js';
import { prisma } from '../../db.js';

export type EngineeringSourceManifestEntry = {
  id: string;
  title: string;
  publisher: string;
  category: string;
  jurisdiction: string;
  sourceUrl: string;
  expectedFormat?: string;
  expectedStatus?: string;
  autoDownload?: boolean;
  priority?: number;
  officialDomain: string;
  licenseStatus?: string;
  verificationStatus?: string;
  edition?: string;
  revision?: string;
  effectiveDate?: string;
  notes?: string;
};

export type SourceSyncResult = {
  id: string;
  title: string;
  status: string;
  downloadStatus: string;
  fileHash?: string;
  localFilePath?: string;
  reason?: string;
};

const verificationRank: Record<string, number> = { OFFICIAL_CURRENT: 1, VERIFIED: 3, REVIEWED: 4, OFFICIAL_HISTORICAL: 5, UNVERIFIED: 6, SUPERSEDED: 7, UNKNOWN: 8 };
const sourceTypeRank: Record<string, number> = { REGULATION: 1, REGULATION_COMMENTARY: 2, WORKED_EXAMPLE: 2, STRUCTURAL_TABLE: 3, MANUFACTURER_CATALOG: 3, FMH_PROJECT: 4, FMH_DRAWING: 4, FMH_CALCULATION: 4, INTERNATIONAL_REFERENCE: 6, EDUCATIONAL_REFERENCE: 7, OTHER: 8 };

export function sourcePriority(source: { sourceType: string; verificationStatus: string }) {
  return Math.min(sourceTypeRank[source.sourceType] || 8, 8) + (verificationRank[source.verificationStatus] || 8) / 100;
}

function hostnameAllowed(url: URL, officialDomain: string) {
  const host = url.hostname.toLowerCase();
  const domain = officialDomain.toLowerCase().replace(/^\.+/, '');
  return host === domain || host.endsWith(`.${domain}`);
}

export function validatePublicSourceUrl(sourceUrl: string, officialDomain: string) {
  let url: URL;
  try { url = new URL(sourceUrl); } catch { throw new Error('La fuente no contiene una URL válida.'); }
  if (url.protocol !== 'https:') throw new Error('Sólo se permiten fuentes HTTPS públicas.');
  if (!hostnameAllowed(url, officialDomain)) throw new Error(`El dominio ${url.hostname} no coincide con ${officialDomain}.`);
  return url;
}

function safeFileName(entry: EngineeringSourceManifestEntry, finalUrl: string, mimeType: string | null) {
  const extension = path.extname(new URL(finalUrl).pathname) || (mimeType?.includes('pdf') ? '.pdf' : '.bin');
  const slug = entry.id.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  return `${slug}${extension.toLowerCase()}`;
}

async function upsertSource(entry: EngineeringSourceManifestEntry, data: Record<string, unknown> = {}) {
  const existing = await prisma.engineeringSource.findUnique({ where: { id: entry.id } });
  const base = {
    title: entry.title,
    publisher: entry.publisher,
    jurisdiction: entry.jurisdiction,
    sourceType: entry.category,
    sourceUrl: entry.sourceUrl,
    officialDomain: entry.officialDomain,
    language: entry.jurisdiction === 'AR' ? 'es' : 'en',
    licenseStatus: entry.licenseStatus || 'UNKNOWN',
    verificationStatus: entry.verificationStatus || 'UNKNOWN',
    edition: entry.edition,
    revision: entry.revision,
    effectiveDate: entry.effectiveDate ? new Date(entry.effectiveDate) : undefined,
    notes: entry.notes,
    metadataJson: JSON.stringify({ manifestId: entry.id, expectedFormat: entry.expectedFormat, expectedStatus: entry.expectedStatus, priority: entry.priority ?? 8 }),
    ...data
  };
  if (existing) return prisma.engineeringSource.update({ where: { id: existing.id }, data: base });
  return prisma.engineeringSource.create({ data: { id: entry.id, ...base } });
}

async function syncOne(entry: EngineeringSourceManifestEntry): Promise<SourceSyncResult> {
  try { validatePublicSourceUrl(entry.sourceUrl, entry.officialDomain); } catch (error) {
    await upsertSource(entry, { downloadStatus: 'DOWNLOAD_FAILED', lastCheckedAt: new Date(), notes: `${entry.notes || ''} ${error instanceof Error ? error.message : 'URL rechazada'}`.trim() });
    return { id: entry.id, title: entry.title, status: 'REJECTED', downloadStatus: 'DOWNLOAD_FAILED', reason: error instanceof Error ? error.message : 'URL rechazada' };
  }
  if (!entry.autoDownload) {
    await upsertSource(entry, { downloadStatus: 'NOT_ATTEMPTED', lastCheckedAt: new Date() });
    return { id: entry.id, title: entry.title, status: 'REGISTERED', downloadStatus: 'NOT_ATTEMPTED' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(entry.sourceUrl, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'FMH-Golden-Library/1.0 (controlled public-source importer)' } });
    const finalUrl = response.url || entry.sourceUrl;
    validatePublicSourceUrl(finalUrl, entry.officialDomain);
    if (response.status === 401 || response.status === 403) {
      await upsertSource(entry, { finalUrl, lastCheckedAt: new Date(), downloadStatus: 'ACCESS_RESTRICTED' });
      return { id: entry.id, title: entry.title, status: 'RESTRICTED', downloadStatus: 'ACCESS_RESTRICTED', reason: `HTTP ${response.status}` };
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    const fileHash = crypto.createHash('sha256').update(body).digest('hex');
    const mimeType = response.headers.get('content-type')?.split(';')[0] || undefined;
    const existing = await prisma.engineeringSource.findUnique({ where: { id: entry.id } });
    const revisionEntry = existing?.fileHash && existing.fileHash !== fileHash
      ? { ...entry, id: `${entry.id}-${fileHash.slice(0, 12)}`, revision: `${entry.revision || entry.edition || 'revision'}-${fileHash.slice(0, 8)}` }
      : entry;
    const duplicate = await prisma.engineeringSource.findFirst({ where: { fileHash, id: { not: revisionEntry.id } }, select: { localFilePath: true } });
    const storageRoot = path.resolve(config.ENGINEERING_SOURCE_STORAGE_ROOT);
    const target = duplicate?.localFilePath ? path.resolve(config.UPLOAD_DIR, duplicate.localFilePath) : path.join(storageRoot, safeFileName(revisionEntry, finalUrl, mimeType || null));
    const relativePath = duplicate?.localFilePath || path.relative(path.resolve(config.UPLOAD_DIR), target).split(path.sep).join('/');
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (!duplicate?.localFilePath) await fs.writeFile(target, body);
    const source = await upsertSource(revisionEntry, { finalUrl, localFilePath: relativePath, retrievedAt: new Date(), lastCheckedAt: new Date(), contentHash: fileHash, fileHash, mimeType, downloadStatus: duplicate ? 'UNCHANGED' : 'DOWNLOADED' });
    if (existing?.fileHash && existing.fileHash !== fileHash) await prisma.engineeringSource.update({ where: { id: existing.id }, data: { verificationStatus: 'SUPERSEDED', supersededById: source.id, lastCheckedAt: new Date() } });
    return { id: source.id, title: source.title, status: existing?.fileHash && existing.fileHash !== fileHash ? 'NEW_REVISION' : 'SYNCED', downloadStatus: source.downloadStatus, fileHash, localFilePath: relativePath };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Error de descarga';
    const restricted = /401|403|autoriz|restricted|abort/i.test(reason);
    await upsertSource(entry, { lastCheckedAt: new Date(), downloadStatus: restricted ? 'ACCESS_RESTRICTED' : 'DOWNLOAD_FAILED', notes: `${entry.notes || ''} ${reason}`.trim() });
    return { id: entry.id, title: entry.title, status: restricted ? 'RESTRICTED' : 'FAILED', downloadStatus: restricted ? 'ACCESS_RESTRICTED' : 'DOWNLOAD_FAILED', reason };
  } finally { clearTimeout(timeout); }
}

export async function loadEngineeringSourceManifest(manifestPath = path.resolve('config/engineering-sources.json')) {
  const parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) throw new Error('El manifiesto de fuentes debe ser un array.');
  return parsed as EngineeringSourceManifestEntry[];
}

export async function syncEngineeringSources(manifestPath?: string) {
  const manifest = await loadEngineeringSourceManifest(manifestPath);
  const results: SourceSyncResult[] = [];
  for (const entry of manifest) results.push(await syncOne(entry));
  return { manifestCount: manifest.length, results };
}

export async function checkForSourceUpdates(manifestPath?: string) {
  return syncEngineeringSources(manifestPath);
}

/** Runs the same allowlist/hash/download policy without a database connection.
 * It is useful for a local workstation bootstrap; the normal sync later persists
 * the returned files and hashes into EngineeringSource. */
export async function syncEngineeringSourcesOffline(manifestPath?: string) {
  const manifest = await loadEngineeringSourceManifest(manifestPath);
  const storageRoot = path.resolve(config.ENGINEERING_SOURCE_STORAGE_ROOT);
  await fs.mkdir(storageRoot, { recursive: true });
  const results: SourceSyncResult[] = [];
  for (const entry of manifest) {
    try {
      const sourceUrl = validatePublicSourceUrl(entry.sourceUrl, entry.officialDomain);
      if (!entry.autoDownload) { results.push({ id: entry.id, title: entry.title, status: 'REGISTERED', downloadStatus: 'NOT_ATTEMPTED' }); continue; }
      const response = await fetch(sourceUrl, { redirect: 'follow', headers: { 'User-Agent': 'FMH-Golden-Library/1.0 (controlled public-source importer)' } });
      const finalUrl = response.url || entry.sourceUrl;
      validatePublicSourceUrl(finalUrl, entry.officialDomain);
      if (response.status === 401 || response.status === 403) { results.push({ id: entry.id, title: entry.title, status: 'RESTRICTED', downloadStatus: 'ACCESS_RESTRICTED', reason: `HTTP ${response.status}` }); continue; }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      const fileHash = crypto.createHash('sha256').update(body).digest('hex');
      const target = path.join(storageRoot, safeFileName(entry, finalUrl, response.headers.get('content-type')));
      await fs.writeFile(target, body);
      results.push({ id: entry.id, title: entry.title, status: 'SYNCED_OFFLINE', downloadStatus: 'DOWNLOADED', fileHash, localFilePath: path.relative(process.cwd(), target).split(path.sep).join('/') });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Error de descarga';
      results.push({ id: entry.id, title: entry.title, status: 'FAILED', downloadStatus: /401|403|autoriz|restricted/i.test(reason) ? 'ACCESS_RESTRICTED' : 'DOWNLOAD_FAILED', reason });
    }
  }
  return { manifestCount: manifest.length, results };
}

export async function engineeringSourceStatus() {
  return prisma.engineeringSource.findMany({ orderBy: [{ jurisdiction: 'asc' }, { title: 'asc' }], include: { documents: { select: { id: true, status: true, verified: true } } } });
}

export type EngineeringMethodContext = {
  jurisdiction: string;
  primaryStandard: string;
  edition?: string;
  supportingReferences: Array<{ id: string; title: string; jurisdiction: string; usagePolicy: 'PRIMARY' | 'SUPPORTING' | 'BENCHMARK_REFERENCE' | 'INTERNATIONAL_REFERENCE' }>;
};

export function assertMethodContext(context: EngineeringMethodContext) {
  const invalid = context.supportingReferences.filter((reference) => reference.usagePolicy === 'PRIMARY' && reference.jurisdiction !== context.jurisdiction);
  if (invalid.length) throw new Error(`No se puede mezclar la norma primaria ${context.primaryStandard} con ${invalid.map((item) => item.title).join(', ')}.`);
  return context;
}
