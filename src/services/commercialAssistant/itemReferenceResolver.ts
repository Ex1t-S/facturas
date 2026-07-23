import type { CommercialDraftItem, ItemReference } from './types.js';
import { foldCommercialText } from './normalizer.js';

const ordinalNumbers: Record<string, number> = {
  un: 1,
  uno: 1,
  una: 1,
  primero: 1,
  primer: 1,
  dos: 2,
  segundo: 2,
  segunda: 2,
  tres: 3,
  tercero: 3,
  tercer: 3,
  cuatro: 4,
  cuarto: 4,
  cinco: 5,
  quinto: 5,
  seis: 6,
  sexto: 6,
  siete: 7,
  septimo: 7,
  ocho: 8,
  octavo: 8,
  nueve: 9,
  noveno: 9,
  diez: 10,
  decimo: 10
};

export function parseItemReference(value: string): ItemReference {
  const normalized = foldCommercialText(value)
    .replace(/^(?:al?|del?|de la|los?|las?)\s+/, '')
    .replace(/[.,;:]+$/g, '')
    .trim();
  if (/\b(?:ultimo|ultima)(?:\s+(?:punto|item|renglon|linea))?\b/.test(normalized) || /\bel anterior\b/.test(normalized)) {
    return { kind: 'LAST' };
  }
  if (/^(?:el\s+)?(?:primero|primer(?:\s+(?:item|punto|renglon|linea))?)$/.test(normalized)) return { kind: 'FIRST' };
  const index = normalized.match(/(?:item|punto|renglon|linea)?\s*(\d+)\b/);
  if (index) return { kind: 'INDEX', index: Number(index[1]) };
  const word = normalized.match(/(?:item|punto|renglon|linea)\s+(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|primero|primer|segundo|tercero|tercer|cuarto|quinto|sexto|septimo|octavo|noveno|decimo)\b/);
  if (word?.[1]) return { kind: 'INDEX', index: ordinalNumbers[word[1]]! };
  if (ordinalNumbers[normalized] !== undefined) return { kind: 'INDEX', index: ordinalNumbers[normalized]! };
  const lineId = normalized.match(/\blineid\s+([a-z0-9_-]+)\b/);
  if (lineId?.[1]) return { kind: 'LINE_ID', lineId: lineId[1] };
  return {
    kind: 'TEXT',
    query: normalized
      .replace(/^(?:item|punto|renglon|linea)\s+/, '')
      .replace(/^(?:que|dice)\s+/, '')
      .replace(/^el\s+(?:de|que dice)\s+/, '')
      .trim()
  };
}

export type ItemReferenceResolution =
  | { kind: 'RESOLVED'; lineId: string; index: number }
  | { kind: 'AMBIGUOUS'; candidates: Array<{ lineId: string; index: number; description: string }> }
  | { kind: 'NOT_FOUND' };

export function resolveItemReference(reference: ItemReference, items: CommercialDraftItem[]): ItemReferenceResolution {
  if (!items.length) return { kind: 'NOT_FOUND' };
  if (reference.kind === 'FIRST') return { kind: 'RESOLVED', lineId: items[0]!.lineId, index: 0 };
  if (reference.kind === 'LAST') {
    const index = items.length - 1;
    return { kind: 'RESOLVED', lineId: items[index]!.lineId, index };
  }
  if (reference.kind === 'INDEX') {
    const index = reference.index - 1;
    return index >= 0 && index < items.length
      ? { kind: 'RESOLVED', lineId: items[index]!.lineId, index }
      : { kind: 'NOT_FOUND' };
  }
  if (reference.kind === 'LINE_ID') {
    const index = items.findIndex((item) => item.lineId === reference.lineId);
    return index >= 0 ? { kind: 'RESOLVED', lineId: items[index]!.lineId, index } : { kind: 'NOT_FOUND' };
  }
  const query = foldCommercialText(reference.query);
  if (!query) return { kind: 'NOT_FOUND' };
  const queryTokens = query.split(' ').filter((token) => token.length >= 2 && !['el', 'la', 'de', 'que'].includes(token));
  const candidates = items
    .map((item, index) => ({ lineId: item.lineId, index, description: item.description, folded: foldCommercialText(item.description) }))
    .filter((item) => item.folded === query || item.folded.includes(query) || (queryTokens.length > 0 && queryTokens.every((token) => item.folded.includes(token))))
    .map(({ lineId, index, description }) => ({ lineId, index, description }));
  if (candidates.length === 1) return { kind: 'RESOLVED', lineId: candidates[0]!.lineId, index: candidates[0]!.index };
  if (candidates.length > 1) return { kind: 'AMBIGUOUS', candidates };
  return { kind: 'NOT_FOUND' };
}
