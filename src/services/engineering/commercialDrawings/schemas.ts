import { z } from 'zod';
import { equipmentTypes } from './types.js';

const stringRecordValue = z.union([z.string(), z.number(), z.boolean()]);

export const engineeringDesignRequestV2Schema = z.object({
  schemaVersion: z.literal('2.0').default('2.0'),
  equipmentType: z.enum(equipmentTypes),
  projectName: z.string().trim().max(160).default('Propuesta comercial orientativa'),
  customerName: z.string().trim().max(160).default('Cliente a confirmar'),
  productOrMaterial: z.string().trim().min(1).max(120),
  capacity: z.number().positive(),
  capacityUnit: z.enum(['t', 'kg', 'm3', 't/h', 'm3/h']),
  requestedDimensions: z.record(z.string().max(80), z.number().nonnegative()).default({}),
  siteRestrictions: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  preferredConfiguration: z.record(z.string().max(80), stringRecordValue).default({}),
  requiredComponents: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  optionalComponents: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  operatingConditions: z.record(z.string().max(80), stringRecordValue).default({}),
  userNotes: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  sourceConversationId: z.string().trim().min(1).nullable().default(null),
  sourceBudgetId: z.string().trim().min(1).nullable().default(null)
}).strict();

export const codexDesignExtractionSchema = z.object({
  equipmentType: z.enum(equipmentTypes).nullable(),
  projectName: z.string().nullable(),
  customerName: z.string().nullable(),
  productOrMaterial: z.string().nullable(),
  capacity: z.number().nullable(),
  capacityUnit: z.enum(['t', 'kg', 'm3', 't/h', 'm3/h']).nullable(),
  requestedDimensionsMm: z.object({
    diameter: z.number().nullable(),
    cylindricalHeight: z.number().nullable(),
    roofHeight: z.number().nullable(),
    hopperHeight: z.number().nullable(),
    dischargeClearance: z.number().nullable(),
    outletDiameter: z.number().nullable(),
    supportPitchDiameter: z.number().nullable(),
    floorLevel: z.number().nullable()
  }).strict(),
  siteRestrictions: z.array(z.string()),
  preferredConfiguration: z.object({
    siloType: z.string().nullable(),
    bottomType: z.string().nullable(),
    roofType: z.string().nullable(),
    supportCount: z.number().nullable()
  }).strict(),
  requiredComponents: z.array(z.string()),
  optionalComponents: z.array(z.string()),
  operatingConditions: z.object({
    bulkDensityKgM3: z.number().nullable(),
    fillFactor: z.number().nullable(),
    environment: z.string().nullable()
  }).strict(),
  userNotes: z.array(z.string()),
  missingData: z.array(z.string()),
  interpretationNotes: z.array(z.string())
}).strict();

export type CodexDesignExtraction = z.infer<typeof codexDesignExtractionSchema>;

export const codexDesignExtractionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    equipmentType: { anyOf: [{ type: 'string', enum: [...equipmentTypes] }, { type: 'null' }] },
    projectName: { type: ['string', 'null'] },
    customerName: { type: ['string', 'null'] },
    productOrMaterial: { type: ['string', 'null'] },
    capacity: { type: ['number', 'null'] },
    capacityUnit: { anyOf: [{ type: 'string', enum: ['t', 'kg', 'm3', 't/h', 'm3/h'] }, { type: 'null' }] },
    requestedDimensionsMm: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries([
        'diameter',
        'cylindricalHeight',
        'roofHeight',
        'hopperHeight',
        'dischargeClearance',
        'outletDiameter',
        'supportPitchDiameter',
        'floorLevel'
      ].map((key) => [key, { type: ['number', 'null'] }])),
      required: ['diameter', 'cylindricalHeight', 'roofHeight', 'hopperHeight', 'dischargeClearance', 'outletDiameter', 'supportPitchDiameter', 'floorLevel']
    },
    siteRestrictions: { type: 'array', items: { type: 'string' } },
    preferredConfiguration: {
      type: 'object',
      additionalProperties: false,
      properties: {
        siloType: { type: ['string', 'null'] },
        bottomType: { type: ['string', 'null'] },
        roofType: { type: ['string', 'null'] },
        supportCount: { type: ['number', 'null'] }
      },
      required: ['siloType', 'bottomType', 'roofType', 'supportCount']
    },
    requiredComponents: { type: 'array', items: { type: 'string' } },
    optionalComponents: { type: 'array', items: { type: 'string' } },
    operatingConditions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        bulkDensityKgM3: { type: ['number', 'null'] },
        fillFactor: { type: ['number', 'null'] },
        environment: { type: ['string', 'null'] }
      },
      required: ['bulkDensityKgM3', 'fillFactor', 'environment']
    },
    userNotes: { type: 'array', items: { type: 'string' } },
    missingData: { type: 'array', items: { type: 'string' } },
    interpretationNotes: { type: 'array', items: { type: 'string' } }
  },
  required: [
    'equipmentType',
    'projectName',
    'customerName',
    'productOrMaterial',
    'capacity',
    'capacityUnit',
    'requestedDimensionsMm',
    'siteRestrictions',
    'preferredConfiguration',
    'requiredComponents',
    'optionalComponents',
    'operatingConditions',
    'userNotes',
    'missingData',
    'interpretationNotes'
  ]
} as const;
