import { z } from 'zod';
import { engineeringIntents } from './engineeringIntelligence.js';

export const documentTypes = ['QUOTE', 'PROJECT', 'CALCULATION', 'DRAWING', 'PRODUCT', 'MATERIAL_LIST', 'INVOICE', 'DELIVERY_NOTE', 'TECHNICAL_NOTE', 'OTHER'] as const;
export const projectTypes = ['SILO', 'WAREHOUSE', 'HOPPER', 'ELEVATOR', 'AUGER', 'CONVEYOR', 'STEEL_STRUCTURE', 'SUPPORT_STRUCTURE', 'PLATFORM', 'STAIR', 'WALKWAY', 'DUCT', 'PIPING', 'TANK', 'CHASSIS', 'BASE', 'REELER', 'REPAIR', 'INSTALLATION', 'CUSTOM_EQUIPMENT', 'OTHER'] as const;
export const knowledgeStatuses = ['DISCOVERED', 'EXTRACTING', 'EXTRACTED', 'NEEDS_VISION', 'NEEDS_REVIEW', 'INDEXED', 'FAILED', 'UNSUPPORTED'] as const;

export const engineeringExtractionSchema = z.object({
  documentType: z.enum(documentTypes).default('OTHER'),
  projectType: z.enum(projectTypes).default('OTHER'),
  projectName: z.string().optional(), customerName: z.string().optional(), date: z.string().optional(), location: z.string().optional(), description: z.string().optional(),
  capacities: z.array(z.object({ value: z.number(), unit: z.string(), meaning: z.string() })).default([]),
  dimensions: z.array(z.object({ name: z.string(), value: z.number(), unit: z.string() })).default([]),
  materials: z.array(z.object({ rawName: z.string(), normalizedName: z.string().optional(), category: z.string().optional(), specification: z.string().optional(), dimensions: z.string().optional(), quantity: z.number().optional(), unit: z.string().optional(), unitWeight: z.number().optional(), totalWeight: z.number().optional() })).default([]),
  components: z.array(z.object({ name: z.string(), quantity: z.number().optional(), specification: z.string().optional() })).default([]),
  costs: z.array(z.object({ description: z.string(), amount: z.number(), currency: z.string(), costType: z.string().optional() })).default([]),
  engineeringVariables: z.array(z.object({ name: z.string(), symbol: z.string().optional(), value: z.number().optional(), unit: z.string().optional(), description: z.string().optional() })).default([]),
  formulasOrMethods: z.array(z.object({ description: z.string(), expression: z.string().optional() })).default([]),
  assumptions: z.array(z.string()).default([]), observations: z.array(z.string()).default([]), warnings: z.array(z.string()).default([]),
  evidence: z.array(z.object({ field: z.string(), excerpt: z.string(), page: z.number().optional() })).default([]),
  extractionConfidence: z.number().min(0).max(1).default(0)
});

export const engineeringAssistantResultSchema = z.object({
  intent: z.enum(engineeringIntents),
  subject: z.string(), answer: z.string(),
  inputData: z.array(z.object({ name: z.string(), value: z.union([z.string(), z.number()]), unit: z.string().optional(), source: z.enum(['USER', 'DOCUMENT', 'ASSUMPTION', 'CALCULATION', 'FMH_PRECEDENT', 'INVENTORY', 'REGULATION', 'MODEL_INFERENCE']) })).default([]),
  missingData: z.array(z.object({ name: z.string(), reason: z.string(), critical: z.boolean() })).default([]), assumptions: z.array(z.string()).default([]),
  calculations: z.array(z.object({ title: z.string(), formula: z.string().optional(), inputs: z.array(z.object({ name: z.string(), value: z.number(), unit: z.string() })).default([]), result: z.number(), resultUnit: z.string(), explanation: z.string().optional() })).default([]),
  materials: z.array(z.object({ description: z.string(), specification: z.string().optional(), quantity: z.number().optional(), unit: z.string().optional(), estimatedWeightKg: z.number().optional(), totalLengthM: z.number().optional(), source: z.enum(['CALCULATED', 'USER', 'HISTORICAL', 'ESTIMATED']).optional(), sourceTitle: z.string().optional(), candidateId: z.string().optional() })).default([]),
  purchase: z.array(z.object({ description: z.string(), need: z.number(), unit: z.string(), commercialLength: z.number().optional(), buyQuantity: z.number().optional(), purchasedTotal: z.number().optional(), waste: z.number().optional(), stockAvailable: z.number().optional(), toBuy: z.number().optional(), price: z.number().optional(), priceStatus: z.enum(['CURRENT', 'HISTORICAL', 'ESTIMATED', 'NO_PRICE']).optional(), subtotal: z.number().optional(), cutPlan: z.array(z.object({ cutsM: z.array(z.number()), usedM: z.number(), wasteM: z.number() })).optional() })).default([]),
  estimatedCost: z.object({ currency: z.string(), materials: z.number().optional(), labor: z.number().optional(), other: z.number().optional(), total: z.number().optional() }).optional(),
  sources: z.array(z.object({ id: z.string(), title: z.string(), type: z.string(), relevance: z.number(), url: z.string().url().optional(), excerpt: z.string().optional() })).default([]),
  regulations: z.array(z.object({ code: z.string(), title: z.string(), status: z.string(), sourceUrl: z.string().url().optional(), sourceType: z.enum(['OFFICIAL', 'LOCAL_VERIFIED', 'INTERNAL', 'SECONDARY']).default('INTERNAL') })).default([]),
  goldenLibrary: z.object({
    fmhPrecedents: z.array(z.unknown()).default([]),
    regulations: z.array(z.unknown()).default([]),
    benchmarks: z.array(z.unknown()).default([]),
    sectionCandidates: z.array(z.unknown()).default([]),
    internationalReferences: z.array(z.unknown()).default([])
  }).optional(),
  toolCalls: z.array(z.object({ name: z.string(), status: z.string(), summary: z.string().optional() })).default([]),
  warnings: z.array(z.string()).default([]), confidence: z.number().min(0).max(1).default(0), reviewRequired: z.boolean().default(true),
  level: z.enum(['ORIENTATION', 'ESTIMATION', 'PRELIMINARY_DESIGN', 'VERIFIED_CALCULATION']).default('ORIENTATION'),
  model: z.string().optional(), capability: z.enum(['SUPPORTED_DETERMINISTIC', 'PRELIMINARY_ASSISTED', 'NOT_IMPLEMENTED']).default('PRELIMINARY_ASSISTED'),
  provider: z.enum(['openai', 'local']).default('local'),
  requestedModel: z.string().optional(),
  actualModel: z.string().optional(),
  responseId: z.string().optional(),
  fallbackUsed: z.boolean().default(false),
  latencyMs: z.number().int().nonnegative().optional(),
  intentConfidence: z.number().min(0).max(1).optional(),
  executionError: z.object({ type: z.string().optional(), code: z.string().optional(), status: z.number().optional(), message: z.string() }).optional(),
  nextAction: z.object({ label: z.string(), type: z.string() }).optional()
});

export type EngineeringExtraction = z.infer<typeof engineeringExtractionSchema>;
export type EngineeringAssistantResult = z.infer<typeof engineeringAssistantResultSchema>;
