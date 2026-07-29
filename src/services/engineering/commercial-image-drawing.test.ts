import fs from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  buildCommercialEngineeringImagePrompt,
  commercialImageApiSettings,
  generateCommercialEngineeringDrawing,
  resolveCommercialImageTemplatePath,
  type CommercialImageDrawingDependencies,
  type CommercialImageEvaluation
} from './commercial-image-drawing.js';

const request = {
  companyId: 'company-1',
  drawingType: 'GRAIN_STORAGE_PLANT' as const,
  equipmentType: 'Planta de silos',
  projectName: 'Planta de almacenamiento',
  customerName: 'Cliente',
  budgetNumber: 'P-0001',
  title: 'Distribución general en planta',
  product: 'Trigo',
  capacity: '4 silos de 400 t',
  equipmentDescription: 'Cuatro silos en matriz 2 × 2 con noria central.',
  equipmentList: ['Silo metálico 1 — 400 t', 'Silo metálico 2 — 400 t'],
  requestedViews: ['Planta general', 'Corte frontal inferior'],
  requestedDetails: ['Flechas de flujo'],
  approximateDimensions: ['Diámetro de silos: 15.000 mm'],
  additionalNotes: ['Documento orientativo'],
  layoutDescription: '',
  generatedBy: 'Ingeniero Civil German Arroyo - ID 03136/5'
};

function evaluation(score0: number, score1: number): CommercialImageEvaluation {
  const alternative = (index: number, value: number) => ({
    index,
    templateSimilarity: value,
    technicalDrawingAppearance: value,
    sheetUsage: value,
    completeFrame: value,
    completeTitleBlock: value,
    completeTables: value,
    requestedEquipmentPresent: value,
    professionalComposition: value,
    nonArtisticAppearance: value,
    generalLegibility: value,
    summary: `Alternativa ${index}`
  });
  return {
    alternatives: [alternative(0, score0), alternative(1, score1)],
    selectionReason: 'La alternativa elegida conserva mejor la estructura.'
  };
}

describe('commercial engineering image drawing', () => {
  it('uses the mandatory OpenAI image edit settings and bundled template', async () => {
    expect(commercialImageApiSettings()).toEqual({
      model: 'gpt-image-2-2026-04-21',
      quality: 'high',
      size: '2048x1440',
      output_format: 'png',
      background: 'opaque',
      n: 2
    });
    const template = await fs.readFile(resolveCommercialImageTemplatePath());
    expect(template.byteLength).toBeGreaterThan(100_000);
  });

  it('builds the closed prompt with the commercial warning and project data', () => {
    const prompt = buildCommercialEngineeringImagePrompt(request);
    expect(prompt).toContain('Utilizá la imagen proporcionada como plantilla visual obligatoria.');
    expect(prompt).toContain('Proyecto: Planta de almacenamiento');
    expect(prompt).toContain('Cliente: Cliente');
    expect(prompt).toContain('DISEÑO Y DIMENSIONES ORIENTATIVAS PARA COTIZACIÓN');
    expect(prompt).toContain('No generar una fotografía.');
  });

  it('generates two alternatives, evaluates them and persists only the best PNG', async () => {
    const editImages = vi.fn(async () => [Buffer.from('alternative-0'), Buffer.from('alternative-1')]);
    const evaluateImages = vi.fn(async () => evaluation(7.4, 8.8));
    const persist = vi.fn(async ({ image }: Parameters<CommercialImageDrawingDependencies['persist']>[0]) => {
      expect(image.toString()).toBe('alternative-1');
      return { id: 'drawing-1' };
    });
    const result = await generateCommercialEngineeringDrawing(request, {
      loadTemplate: async () => Buffer.from('template'),
      editImages,
      evaluateImages,
      persist
    });
    expect(editImages).toHaveBeenCalledTimes(1);
    expect(editImages.mock.calls[0][0].template.toString()).toBe('template');
    expect(evaluateImages).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ drawingId: 'drawing-1', score: 8.8, attempts: 1, template: 'plant-silos-a3-reference.png' });
  });

  it('retries from the original template when the best score is below seven', async () => {
    const editImages = vi.fn(async () => [Buffer.from('a'), Buffer.from('b')]);
    const evaluateImages = vi.fn()
      .mockResolvedValueOnce(evaluation(5, 6))
      .mockResolvedValueOnce(evaluation(7.5, 8));
    const persist = vi.fn(async () => ({ id: 'drawing-retry' }));
    const template = Buffer.from('original-template');
    const result = await generateCommercialEngineeringDrawing(request, {
      loadTemplate: async () => template,
      editImages,
      evaluateImages,
      persist
    });
    expect(result.attempts).toBe(2);
    expect(editImages).toHaveBeenCalledTimes(2);
    expect(editImages.mock.calls.every(([call]) => call.template === template)).toBe(true);
    expect(editImages.mock.calls[1][0].prompt).toContain('En el intento anterior se perdió la estructura visual.');
  });

  it('does not import or invoke the legacy SVG renderer in this flow', async () => {
    const source = await fs.readFile(new URL('./commercial-image-drawing.ts', import.meta.url), 'utf8');
    expect(source).toContain('.images.edit(');
    expect(source).not.toContain("from './drawing");
    expect(source).not.toContain('renderPreliminaryEngineeringSvg');
    expect(source).not.toContain('renderDrawingSceneToSvg');
  });
});
