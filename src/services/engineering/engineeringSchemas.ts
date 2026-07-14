import { z } from 'zod';

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
  intent: z.enum(['GENERAL_QUESTION', 'PRELIMINARY_CALCULATION', 'SIMILAR_PROJECT_SEARCH', 'MATERIAL_ESTIMATE', 'COST_ESTIMATE', 'PROJECT_COMPARISON', 'BOM', 'DATA_REQUEST', 'OTHER']),
  subject: z.string(), answer: z.string(),
  inputData: z.array(z.object({ name: z.string(), value: z.union([z.string(), z.number()]), unit: z.string().optional(), source: z.enum(['USER', 'DOCUMENT', 'ASSUMPTION']) })).default([]),
  missingData: z.array(z.object({ name: z.string(), reason: z.string(), critical: z.boolean() })).default([]), assumptions: z.array(z.string()).default([]),
  calculations: z.array(z.object({ title: z.string(), formula: z.string().optional(), inputs: z.array(z.object({ name: z.string(), value: z.number(), unit: z.string() })).default([]), result: z.number(), resultUnit: z.string(), explanation: z.string().optional() })).default([]),
  materials: z.array(z.object({ description: z.string(), quantity: z.number().optional(), unit: z.string().optional(), estimatedWeightKg: z.number().optional() })).default([]),
  estimatedCost: z.object({ currency: z.string(), materials: z.number().optional(), labor: z.number().optional(), other: z.number().optional(), total: z.number().optional() }).optional(),
  sources: z.array(z.object({ id: z.string(), title: z.string(), type: z.string(), relevance: z.number(), url: z.string().url().optional(), excerpt: z.string().optional() })).default([]),
  regulations: z.array(z.object({ code: z.string(), title: z.string(), status: z.string(), sourceUrl: z.string().url().optional(), sourceType: z.enum(['OFFICIAL', 'LOCAL_VERIFIED', 'INTERNAL', 'SECONDARY']).default('INTERNAL') })).default([]),
  toolCalls: z.array(z.object({ name: z.string(), status: z.string(), summary: z.string().optional() })).default([]),
  warnings: z.array(z.string()).default([]), confidence: z.number().min(0).max(1).default(0), reviewRequired: z.boolean().default(true),
  level: z.enum(['ORIENTATION', 'ESTIMATION', 'PRELIMINARY_DESIGN', 'VERIFIED_CALCULATION']).default('ORIENTATION'),
  model: z.string().optional(), capability: z.enum(['SUPPORTED_DETERMINISTIC', 'PRELIMINARY_ASSISTED', 'NOT_IMPLEMENTED']).default('PRELIMINARY_ASSISTED')
});

export type EngineeringExtraction = z.infer<typeof engineeringExtractionSchema>;
export type EngineeringAssistantResult = z.infer<typeof engineeringAssistantResultSchema>;
