import {
  MANDATORY_COMMERCIAL_LEGEND,
  PRELIMINARY_DOCUMENT_WARNING,
  type CommercialDrawingTitleBlock
} from './types.js';
import {
  drawingId,
  resetDrawingIds,
  type DrawingEntity,
  type DrawingScene,
  type DrawingSheet
} from './drawingScene.js';

export function drawA3TitleBlock(fields: CommercialDrawingTitleBlock): DrawingEntity {
  return {
    id: drawingId('title-block'),
    type: 'TitleBlock',
    layerId: 'title-block',
    x: 232,
    y: 242,
    width: 178,
    height: 45,
    fields: {
      EMPRESA: fields.company,
      PROYECTO: fields.project,
      CLIENTE: fields.customer,
      PLANO: fields.drawingName,
      EQUIPO: fields.equipment,
      CAPACIDAD: fields.capacity,
      FECHA: fields.date,
      ESCALA: fields.scale,
      DIBUJO: fields.drawnBy,
      REVISO: fields.reviewedBy,
      APROBO: fields.approvedBy,
      NUMERO: fields.drawingNumber,
      REVISION: fields.revision,
      PRESUPUESTO: fields.quoteNumber,
      OBSERVACIONES: fields.observations
    }
  };
}

export function drawA3CommercialSheet(input: {
  designPackId: string;
  designPackVersion: string;
  scale: number;
  titleBlock: CommercialDrawingTitleBlock;
  notes: string[];
}): DrawingScene {
  resetDrawingIds();
  const entities: DrawingEntity[] = [
    {
      id: drawingId('frame'),
      type: 'Rectangle',
      layerId: 'frame',
      x: 10,
      y: 10,
      width: 400,
      height: 277,
      style: { stroke: '#142d26', strokeWidth: 0.45, fill: 'none' }
    },
    {
      id: drawingId('archive-margin'),
      type: 'Line',
      layerId: 'frame',
      start: { x: 20, y: 10 },
      end: { x: 20, y: 287 },
      style: { strokeWidth: 0.3 }
    },
    {
      id: drawingId('document-title'),
      type: 'Text',
      layerId: 'annotations',
      x: 215,
      y: 15,
      text: 'PLANO ORIENTATIVO PARA ANÁLISIS Y PRESUPUESTO',
      style: { fontSize: 3.5, fontWeight: 'bold', textAnchor: 'middle', fill: '#172630' }
    },
    {
      id: drawingId('mandatory-legend-box'),
      type: 'Rectangle',
      layerId: 'warnings',
      x: 20,
      y: 223,
      width: 390,
      height: 17,
      style: { stroke: '#9a302b', strokeWidth: 0.4, fill: '#fff7f5' }
    },
    {
      id: drawingId('mandatory-legend'),
      type: 'Text',
      layerId: 'warnings',
      x: 215,
      y: 229,
      text: MANDATORY_COMMERCIAL_LEGEND,
      maxWidth: 380,
      style: { fontSize: 3.1, fontWeight: 'bold', textAnchor: 'middle', fill: '#8a2824' }
    },
    {
      id: drawingId('preliminary-warning'),
      type: 'Text',
      layerId: 'warnings',
      x: 215,
      y: 235.2,
      text: `${PRELIMINARY_DOCUMENT_WARNING} · NO APTO PARA FABRICACION`,
      maxWidth: 380,
      style: { fontSize: 2.65, textAnchor: 'middle', fill: '#5f2521' }
    },
    {
      id: drawingId('notes-heading'),
      type: 'Text',
      layerId: 'annotations',
      x: 23,
      y: 247,
      text: 'NOTAS, HIPÓTESIS Y ALCANCE',
      style: { fontSize: 3.1, fontWeight: 'bold', fill: '#1f5e45' }
    },
    {
      id: drawingId('notes'),
      type: 'Table',
      layerId: 'annotations',
      x: 22,
      y: 250,
      columnWidths: [207],
      rowHeights: Array.from({ length: Math.min(input.notes.length, 6) }, () => 5.2),
      rows: input.notes.slice(0, 6).map((note, index) => [`${index + 1}. ${note}`]),
      style: { fontSize: 2.45, stroke: '#b7c3be', strokeWidth: 0.2, fill: '#172630' }
    },
    drawA3TitleBlock(input.titleBlock)
  ];
  const sheet: DrawingSheet = {
    id: 'sheet-a3-1',
    size: 'A3',
    orientation: 'LANDSCAPE',
    widthMm: 420,
    heightMm: 297,
    scale: input.scale,
    layers: [
      { id: 'frame', name: 'Marco', visible: true, printable: true, style: { stroke: '#172630', fill: 'none', strokeWidth: 0.3 } },
      { id: 'geometry', name: 'Geometría', visible: true, printable: true, style: { stroke: '#172630', fill: 'none', strokeWidth: 0.35 } },
      { id: 'hidden', name: 'Líneas ocultas', visible: true, printable: true, style: { stroke: '#77827d', fill: 'none', strokeWidth: 0.22, dash: [2, 1.2] } },
      { id: 'center', name: 'Ejes', visible: true, printable: true, style: { stroke: '#7d8984', fill: 'none', strokeWidth: 0.18, dash: [5, 1.5, 1, 1.5] } },
      { id: 'dimensions', name: 'Cotas', visible: true, printable: true, style: { stroke: '#1f5e45', fill: '#1f5e45', strokeWidth: 0.22, fontSize: 2.7 } },
      { id: 'annotations', name: 'Anotaciones', visible: true, printable: true, style: { stroke: '#52615b', fill: '#172630', strokeWidth: 0.2, fontSize: 2.7 } },
      { id: 'warnings', name: 'Advertencias', visible: true, printable: true, style: { stroke: '#8a2824', fill: '#8a2824', strokeWidth: 0.25, fontSize: 2.7 } },
      { id: 'title-block', name: 'Carátula', visible: true, printable: true, style: { stroke: '#172630', fill: '#172630', strokeWidth: 0.25, fontSize: 2.4 } }
    ],
    views: [],
    entities
  };
  return {
    schemaVersion: '1.0',
    units: 'PAPER_MM',
    metadata: {
      designPackId: input.designPackId,
      designPackVersion: input.designPackVersion,
      generatedAt: new Date().toISOString(),
      documentStatus: 'COMMERCIAL_PRELIMINARY'
    },
    sheets: [sheet]
  };
}
