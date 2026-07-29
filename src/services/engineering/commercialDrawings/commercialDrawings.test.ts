import { describe, expect, it } from 'vitest';
import siloFixture from '../../../../fixtures/engineering/silo-400t.json';
import { drawA3CommercialSheet } from './a3Sheet.js';
import { modelToPaper, paperToModel, selectDrawingScale } from './drawingScene.js';
import { renderSceneToPdf } from './pdfRenderer.js';
import { engineeringDesignRequestV2Schema, codexDesignExtractionSchema } from './schemas.js';
import { createCommercialEngineeringDrawing } from './service.js';
import { buildSiloCommercialDesign, createIllustrativeSilo400T } from './siloDesignPack.js';
import { renderSceneToSvg } from './svgRenderer.js';
import { MANDATORY_COMMERCIAL_LEGEND, PRELIMINARY_DOCUMENT_WARNING } from './types.js';

describe('commercial engineering drawings V2', () => {
  const request = engineeringDesignRequestV2Schema.parse(siloFixture);

  it('converts model and paper units consistently', () => {
    expect(modelToPaper(8000, 100)).toBe(80);
    expect(paperToModel(80, 100)).toBe(8000);
    expect(selectDrawingScale(8000, 18800, 82, 194)).toBe(100);
  });

  it('calculates a traceable 400 t silo without AI-calculated values', () => {
    const result = buildSiloCommercialDesign(request);
    expect(result.equipmentGeometry.diameter.value).toBe(8000);
    expect(result.equipmentGeometry.dischargeClearance.value).toBe(4000);
    expect(result.calculatedValues.requiredUsefulVolume.value).toBeCloseTo(512.82, 2);
    expect(Number(result.calculatedValues.estimatedCapacity.value)).toBeGreaterThanOrEqual(395);
    expect(Math.abs(Number(result.calculatedValues.capacityDifference.value))).toBeLessThan(5);
    expect(Object.values(result.calculatedValues).every((item) => item.origin === 'CALCULATED')).toBe(true);
    expect(Object.values(result.assumedValues).every((item) => item.origin === 'ILLUSTRATIVE_ASSUMPTION')).toBe(true);
  });

  it('keeps seeded illustrative geometry reproducible', () => {
    const first = createIllustrativeSilo400T({ seed: 'FMH-SILO-400-001' });
    const second = createIllustrativeSilo400T({ seed: 'FMH-SILO-400-001' });
    expect(first.equipmentGeometry).toEqual(second.equipmentGeometry);
    expect(first.calculatedValues).toEqual(second.calculatedValues);
    expect(first.drawingSpec.drawingNumber).toBe(second.drawingSpec.drawingNumber);
  });

  it('uses one DrawingScene for an A3 SVG with views, dimensions and title block', () => {
    const drawing = createCommercialEngineeringDrawing(request);
    const sheet = drawing.scene.sheets[0];
    expect(sheet.widthMm).toBe(420);
    expect(sheet.heightMm).toBe(297);
    expect(sheet.views.map((view) => view.name)).toEqual(expect.arrayContaining([
      'ELEVACIÓN GENERAL',
      'ELEVACIÓN LATERAL',
      'CORTE LONGITUDINAL A-A',
      'VISTA SUPERIOR',
      'PLANTA DE APOYOS'
    ]));
    expect(sheet.entities.some((entity) => entity.type === 'LinearDimension')).toBe(true);
    expect(sheet.entities.some((entity) => entity.type === 'TitleBlock')).toBe(true);
    expect(drawing.svg).toBe(renderSceneToSvg(drawing.scene));
    expect(drawing.svg).toContain('width="420mm"');
    expect(drawing.svg).toContain(MANDATORY_COMMERCIAL_LEGEND);
    expect(drawing.svg).toContain(PRELIMINARY_DOCUMENT_WARNING);
  });

  it('renders the same A3 DrawingScene to a real PDF', async () => {
    const drawing = createCommercialEngineeringDrawing(request);
    const pdf = await renderSceneToPdf(drawing.scene);
    expect(pdf.subarray(0, 4).toString('ascii')).toBe('%PDF');
    expect(pdf.byteLength).toBeGreaterThan(5000);
    expect(pdf.toString('latin1')).toMatch(/MediaBox\s*\[\s*0\s+0\s+1190/);
  });

  it('requires nulls instead of invented dimensions in Codex extraction', () => {
    const parsed = codexDesignExtractionSchema.parse({
      equipmentType: 'SILO',
      projectName: null,
      customerName: null,
      productOrMaterial: 'trigo',
      capacity: 400,
      capacityUnit: 't',
      requestedDimensionsMm: {
        diameter: null,
        cylindricalHeight: null,
        roofHeight: null,
        hopperHeight: null,
        dischargeClearance: 4000,
        outletDiameter: null,
        supportPitchDiameter: null,
        floorLevel: null
      },
      siteRestrictions: [],
      preferredConfiguration: { siloType: null, bottomType: 'CONICAL', roofType: null, supportCount: null },
      requiredComponents: [],
      optionalComponents: [],
      operatingConditions: { bulkDensityKgM3: null, fillFactor: null, environment: null },
      userNotes: [],
      missingData: ['diameter'],
      interpretationNotes: []
    });
    expect(parsed.requestedDimensionsMm.diameter).toBeNull();
    expect(JSON.stringify(parsed)).not.toContain('CALCULATED');
  });

  it('creates an exact landscape A3 base sheet', () => {
    const scene = drawA3CommercialSheet({
      designPackId: 'test',
      designPackVersion: '1',
      scale: 100,
      titleBlock: {
        company: 'FMH',
        project: 'Prueba',
        customer: 'Cliente',
        drawingName: 'Plano',
        equipment: 'SILO',
        capacity: '400 t',
        date: '29/7/2026',
        scale: '1:100',
        drawnBy: 'FMH',
        reviewedBy: 'Ingeniero Civil German Arroyo - ID 03136/5',
        approvedBy: 'PENDIENTE',
        drawingNumber: 'TEST',
        revision: 'A',
        quoteNumber: 'PENDIENTE',
        observations: 'Preliminar'
      },
      notes: []
    });
    expect(scene.sheets[0]).toMatchObject({ size: 'A3', orientation: 'LANDSCAPE', widthMm: 420, heightMm: 297 });
  });
});
