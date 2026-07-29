import { buildSiloCommercialDesign } from './siloDesignPack.js';
import { buildSiloA3DrawingScene } from './siloDrawing.js';
import { renderSceneToPdf } from './pdfRenderer.js';
import { renderSceneToSvg } from './svgRenderer.js';
import type { CommercialDrawingTitleBlock, EngineeringDesignRequestV2 } from './types.js';

export function createCommercialEngineeringDesign(request: EngineeringDesignRequestV2) {
  if (request.equipmentType === 'SILO') return buildSiloCommercialDesign(request);
  throw Object.assign(new Error(`El DesignPack ${request.equipmentType} todavía no está implementado en el Hito 1.`), { statusCode: 409, code: 'DESIGN_PACK_NOT_IMPLEMENTED' });
}

export function createCommercialEngineeringDrawing(
  request: EngineeringDesignRequestV2,
  titleBlockOverrides: Partial<CommercialDrawingTitleBlock> = {}
) {
  const result = createCommercialEngineeringDesign(request);
  if (request.equipmentType !== 'SILO') throw new Error('El constructor A3 inicial sólo admite silos.');
  const scene = buildSiloA3DrawingScene(result, {
    project: request.projectName,
    customer: request.customerName,
    quoteNumber: request.sourceBudgetId || result.drawingSpec.quoteNumber,
    ...titleBlockOverrides
  }, request.userNotes);
  const svg = renderSceneToSvg(scene);
  return { request, result, scene, svg };
}

export async function createCommercialEngineeringPdf(
  request: EngineeringDesignRequestV2,
  titleBlockOverrides: Partial<CommercialDrawingTitleBlock> = {}
) {
  const drawing = createCommercialEngineeringDrawing(request, titleBlockOverrides);
  return { ...drawing, pdf: await renderSceneToPdf(drawing.scene) };
}
