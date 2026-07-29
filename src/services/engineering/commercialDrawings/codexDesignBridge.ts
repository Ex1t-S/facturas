import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../../../config.js';
import {
  codexDesignExtractionJsonSchema,
  codexDesignExtractionSchema,
  engineeringDesignRequestV2Schema,
  type CodexDesignExtraction
} from './schemas.js';
import type { EngineeringDesignRequestV2 } from './types.js';

type BridgeResult = {
  provider: 'codex-cli';
  model: string;
  extraction: CodexDesignExtraction;
  request: EngineeringDesignRequestV2 | null;
  missingData: string[];
  latencyMs: number;
};

let activeExecutions = 0;

function bridgeAllowed() {
  if (!config.CODEX_ENGINEERING_BRIDGE_ENABLED) return false;
  if (process.env.NODE_ENV === 'production' && !config.CODEX_ENGINEERING_BRIDGE_ALLOW_PRODUCTION) return false;
  return true;
}

function restrictedCodexEnvironment(tempDirectory: string) {
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    CODEX_HOME: process.env.CODEX_HOME,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    TMPDIR: tempDirectory,
    TEMP: tempDirectory,
    TMP: tempDirectory,
    NO_COLOR: '1',
    TERM: 'dumb'
  };
  return Object.fromEntries(Object.entries(environment).filter(([, value]) => value !== undefined));
}

function extractionToRequest(extraction: CodexDesignExtraction, source: {
  conversationId?: string | null;
  budgetId?: string | null;
}): EngineeringDesignRequestV2 | null {
  if (!extraction.equipmentType || !extraction.productOrMaterial || !extraction.capacity || !extraction.capacityUnit) return null;
  const dimensions = Object.fromEntries(
    Object.entries(extraction.requestedDimensionsMm).filter((entry): entry is [string, number] => Number.isFinite(entry[1]) && Number(entry[1]) >= 0)
  );
  const preferredConfiguration = Object.fromEntries(Object.entries(extraction.preferredConfiguration).filter(([, value]) => value !== null));
  const operatingConditions = Object.fromEntries(Object.entries(extraction.operatingConditions).filter(([, value]) => value !== null));
  return engineeringDesignRequestV2Schema.parse({
    schemaVersion: '2.0',
    equipmentType: extraction.equipmentType,
    projectName: extraction.projectName || 'Propuesta comercial orientativa',
    customerName: extraction.customerName || 'Cliente a confirmar',
    productOrMaterial: extraction.productOrMaterial,
    capacity: extraction.capacity,
    capacityUnit: extraction.capacityUnit,
    requestedDimensions: dimensions,
    siteRestrictions: extraction.siteRestrictions,
    preferredConfiguration,
    requiredComponents: extraction.requiredComponents,
    optionalComponents: extraction.optionalComponents,
    operatingConditions,
    userNotes: [...extraction.userNotes, ...extraction.interpretationNotes],
    sourceConversationId: source.conversationId || null,
    sourceBudgetId: source.budgetId || null
  });
}

function codexPrompt(description: string) {
  return [
    'Actuá únicamente como extractor de datos para un sistema de planos comerciales preliminares FMH.',
    'No calcules dimensiones, capacidades, espesores, perfiles, fundaciones ni valores faltantes.',
    'No dibujes y no uses herramientas. Convertí unidades que el usuario haya expresado explícitamente a milímetros.',
    'Los valores no informados deben ser null y deben listarse en missingData.',
    'La salida debe cumplir exactamente el JSON Schema proporcionado.',
    '',
    'Solicitud del usuario:',
    description
  ].join('\n');
}

async function executeCodex(prompt: string) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'fmh-codex-design-'));
  const schemaPath = path.join(tempDirectory, 'design-request.schema.json');
  const outputPath = path.join(tempDirectory, 'design-request.json');
  await fs.writeFile(schemaPath, JSON.stringify(codexDesignExtractionJsonSchema), { encoding: 'utf8', mode: 0o600 });
  const executable = process.platform === 'win32' ? 'codex.cmd' : 'codex';
  const args = [
    'exec',
    '--ephemeral',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--ignore-rules',
    '--ignore-user-config',
    '--color',
    'never',
    '--model',
    config.CODEX_ENGINEERING_BRIDGE_MODEL,
    '--cd',
    tempDirectory,
    '--output-schema',
    schemaPath,
    '--output-last-message',
    outputPath,
    '-'
  ];
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: tempDirectory,
        env: restrictedCodexEnvironment(tempDirectory),
        windowsHide: true,
        shell: process.platform === 'win32'
      });
      let stderr = '';
      let outputBytes = 0;
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Codex excedió el tiempo máximo de interpretación.'));
      }, config.CODEX_ENGINEERING_BRIDGE_TIMEOUT_MS);
      child.stderr.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes <= 256_000) stderr += chunk.toString('utf8');
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('exit', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else reject(new Error(`Codex finalizó con código ${code}: ${stderr.slice(-1200)}`));
      });
      child.stdin.end(prompt);
    });
    return await fs.readFile(outputPath, 'utf8');
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}

export async function interpretEngineeringDesignWithCodex(input: {
  description: string;
  conversationId?: string | null;
  budgetId?: string | null;
}): Promise<BridgeResult> {
  if (!bridgeAllowed()) throw Object.assign(new Error('El puente Codex no está habilitado para este entorno.'), { code: 'CODEX_BRIDGE_DISABLED' });
  if (activeExecutions >= config.CODEX_ENGINEERING_BRIDGE_MAX_CONCURRENCY) {
    throw Object.assign(new Error('El intérprete Codex está ocupado. Intentá nuevamente en unos instantes.'), { code: 'CODEX_BRIDGE_BUSY' });
  }
  activeExecutions += 1;
  const startedAt = Date.now();
  try {
    const output = await executeCodex(codexPrompt(input.description));
    const extraction = codexDesignExtractionSchema.parse(JSON.parse(output));
    return {
      provider: 'codex-cli',
      model: config.CODEX_ENGINEERING_BRIDGE_MODEL,
      extraction,
      request: extractionToRequest(extraction, input),
      missingData: extraction.missingData,
      latencyMs: Date.now() - startedAt
    };
  } finally {
    activeExecutions -= 1;
  }
}

export async function codexEngineeringBridgeStatus() {
  const enabled = bridgeAllowed();
  if (!enabled) {
    return {
      enabled: false,
      configured: config.CODEX_ENGINEERING_BRIDGE_ENABLED,
      productionAllowed: config.CODEX_ENGINEERING_BRIDGE_ALLOW_PRODUCTION,
      authenticated: false,
      model: config.CODEX_ENGINEERING_BRIDGE_MODEL,
      reason: 'disabled'
    };
  }
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'fmh-codex-health-'));
  try {
    const executable = process.platform === 'win32' ? 'codex.cmd' : 'codex';
    const authenticated = await new Promise<boolean>((resolve) => {
      const child = spawn(executable, ['login', 'status'], {
        env: restrictedCodexEnvironment(tempDirectory),
        windowsHide: true,
        shell: process.platform === 'win32'
      });
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(false);
      }, 8000);
      child.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
      child.on('exit', (code) => {
        clearTimeout(timeout);
        resolve(code === 0);
      });
    });
    return {
      enabled: true,
      configured: true,
      productionAllowed: config.CODEX_ENGINEERING_BRIDGE_ALLOW_PRODUCTION,
      authenticated,
      model: config.CODEX_ENGINEERING_BRIDGE_MODEL,
      reason: authenticated ? null : 'codex_not_authenticated'
    };
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}
