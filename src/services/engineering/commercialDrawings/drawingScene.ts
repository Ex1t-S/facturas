export type DrawingPoint = { x: number; y: number };

export type DrawingStyle = {
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  dash?: number[];
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: 'normal' | 'bold';
  textAnchor?: 'start' | 'middle' | 'end';
  opacity?: number;
};

type EntityBase = {
  id: string;
  layerId: string;
  style?: DrawingStyle;
};

export type DrawingEntity =
  | (EntityBase & { type: 'Line' | 'CenterLine' | 'HiddenLine' | 'SectionLine'; start: DrawingPoint; end: DrawingPoint })
  | (EntityBase & { type: 'Polyline'; points: DrawingPoint[]; closed?: boolean })
  | (EntityBase & { type: 'Rectangle'; x: number; y: number; width: number; height: number; radius?: number })
  | (EntityBase & { type: 'Circle'; cx: number; cy: number; radius: number })
  | (EntityBase & { type: 'Ellipse'; cx: number; cy: number; radiusX: number; radiusY: number })
  | (EntityBase & { type: 'Arc'; cx: number; cy: number; radius: number; startAngleDeg: number; endAngleDeg: number })
  | (EntityBase & { type: 'Path'; d: string })
  | (EntityBase & { type: 'Text'; x: number; y: number; text: string; maxWidth?: number; rotateDeg?: number })
  | (EntityBase & { type: 'Hatch'; boundary: DrawingPoint[]; spacing: number; angleDeg: number })
  | (EntityBase & { type: 'LinearDimension'; start: DrawingPoint; end: DrawingPoint; offset: number; text: string })
  | (EntityBase & { type: 'AngularDimension'; center: DrawingPoint; startAngleDeg: number; endAngleDeg: number; radius: number; text: string })
  | (EntityBase & { type: 'DiameterDimension' | 'RadiusDimension'; center: DrawingPoint; edge: DrawingPoint; text: string })
  | (EntityBase & { type: 'Leader'; start: DrawingPoint; elbow: DrawingPoint; end: DrawingPoint; text: string })
  | (EntityBase & { type: 'LevelMarker'; point: DrawingPoint; text: string })
  | (EntityBase & { type: 'DetailCallout'; center: DrawingPoint; radius: number; text: string })
  | (EntityBase & { type: 'Table'; x: number; y: number; columnWidths: number[]; rowHeights: number[]; rows: string[][] })
  | (EntityBase & { type: 'TitleBlock'; x: number; y: number; width: number; height: number; fields: Record<string, string> });

export type DrawingLayer = {
  id: string;
  name: string;
  visible: boolean;
  printable: boolean;
  style: DrawingStyle;
};

export type DrawingView = {
  id: string;
  name: string;
  scale: number;
  bounds: { x: number; y: number; width: number; height: number };
  entityIds: string[];
};

export type DrawingSheet = {
  id: string;
  size: 'A3';
  orientation: 'LANDSCAPE';
  widthMm: 420;
  heightMm: 297;
  scale: number;
  layers: DrawingLayer[];
  views: DrawingView[];
  entities: DrawingEntity[];
};

export type DrawingScene = {
  schemaVersion: '1.0';
  units: 'PAPER_MM';
  metadata: {
    designPackId: string;
    designPackVersion: string;
    generatedAt: string;
    documentStatus: 'COMMERCIAL_PRELIMINARY';
  };
  sheets: DrawingSheet[];
};

let sequence = 0;

export function drawingId(prefix: string) {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

export function resetDrawingIds() {
  sequence = 0;
}

export function transformPoint(point: DrawingPoint, input: {
  origin: DrawingPoint;
  scale: number;
  invertY?: boolean;
}): DrawingPoint {
  return {
    x: input.origin.x + point.x / input.scale,
    y: input.origin.y + (input.invertY ? -point.y : point.y) / input.scale
  };
}

export function modelToPaper(valueMm: number, scale: number) {
  return valueMm / scale;
}

export function paperToModel(valueMm: number, scale: number) {
  return valueMm * scale;
}

export function drawingBoundingBox(points: DrawingPoint[]) {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function selectDrawingScale(maxModelWidthMm: number, maxModelHeightMm: number, availableWidthMm: number, availableHeightMm: number) {
  const scales = [20, 25, 50, 75, 100] as const;
  return scales.find((scale) => maxModelWidthMm / scale <= availableWidthMm && maxModelHeightMm / scale <= availableHeightMm) ?? 100;
}
