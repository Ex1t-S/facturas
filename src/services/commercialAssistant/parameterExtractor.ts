import type {
  ActionClassification,
  CommercialAction,
  CommercialCurrency,
  CommercialDraft,
  DraftItemInput,
  ItemReference
} from './types.js';
import { detectCurrency, parseCommercialNumber, parseMoneyExpression } from './moneyParser.js';
import { foldCommercialText, normalizeCommercialDescription } from './normalizer.js';
import { parseItemReference } from './itemReferenceResolver.js';

function referenceSegment(message: string) {
  const folded = foldCommercialText(message);
  const explicit = folded.match(/\b(?:item|punto|renglon|linea)\s+(?:\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|primero|primer|segundo|tercero|tercer|cuarto|quinto)\b/);
  if (explicit?.[0]) return explicit[0];
  const ordinal = folded.match(/\b(?:el\s+)?(?:primero|primer|segundo|tercero|tercer|cuarto|ultimo|ultima|anterior)(?:\s+(?:item|punto|renglon|linea))?\b/);
  return ordinal?.[0] || '';
}

function extractFileName(message: string) {
  const match = message.match(/\b(?:como|a|por)\s+["']?([^"'\n]+?)["']?\s*$/i);
  return match?.[1]?.trim();
}

export function sanitizeRequestedPdfFileName(value: string) {
  const trimmed = value.trim().replace(/^["']|["']$/g, '');
  if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..') || /[\0<>:"|?*]/.test(trimmed)) {
    return { ok: false as const, reason: 'El nombre de archivo contiene una ruta o caracteres inválidos.' };
  }
  const withoutExtension = trimmed.replace(/\.pdf$/i, '').trim();
  if (!withoutExtension) return { ok: false as const, reason: 'El nombre de archivo está vacío.' };
  const safe = withoutExtension.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ._-]/g, '-').replace(/-+/g, '-');
  return { ok: true as const, fileName: safe + '.pdf' };
}

export function extractCommercialContent(message: string, classification: ActionClassification) {
  if (!['APPEND_ITEM', 'START_DRAFT'].includes(classification.type)) return '';
  let content = message.trim();
  if (classification.type === 'APPEND_ITEM') {
    content = content
      .replace(/^(?:agrega|agregá|agregale|agregále|añade|añadí|sumale|sumále|inclui|incluí|incluye)\s+(?:que\s+)?/i, '')
      .replace(/^(?:tambien|también|ademas|además)\s+/i, '')
      .replace(/^le\s+/i, '');
  }
  return content.trim();
}

function splitCommercialItems(content: string) {
  const verb = '(?:mejoramos|mejorar|limpiamos|limpiar|reparamos|reparar|soldamos|soldar|fabricamos|fabricar|instalamos|instalar|caminamos|caminar|techado|cambiamos|cambiar|colocamos|colocar|retiramos|retirar|revisamos|revisar)';
  return content
    .split(new RegExp(`\\s*[,;\\n]\\s*|\\s+y\\s+(?=${verb}\\b)`, 'i'))
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseItemPart(part: string, inheritedCurrency?: CommercialCurrency): DraftItemInput | null {
  let working = part.trim();
  const currency = detectCurrency(working) ?? inheritedCurrency;
  let money = parseMoneyExpression(working, { inheritedCurrency });

  if (money.amount === undefined && /\b\d+(?:[.,]\d+)?\s*t\b/i.test(working)) {
    const trailing = working.match(/\s+([\d.,]+(?:\s*(?:mil|k))?)\s*$/i);
    if (trailing?.[1]) {
      money = {
        amount: parseCommercialNumber(trailing[1]),
        currency,
        explicit: true
      };
      working = working.slice(0, trailing.index).trim();
    }
  }

  working = working
    .replace(/\b(?:precio|importe|valor|costo)\s*(?:unitario\s*)?(?:a|de|por|en|:|=)?\s*(?:usd|u\$s|ars|\$)?\s*[\d.,]+(?:\s*(?:mil|k))?\s*(?:usd|u\$s|dolares?|ars|pesos?|\$)?/gi, ' ')
    .replace(/\s+(?:a|por)\s+(?:usd|u\$s|ars|\$)?\s*[\d.,]+(?:\s*(?:mil|k))?\s*(?:usd|u\$s|dolares?|ars|pesos?|\$)?\s*$/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const quantityMatch = working.match(/^(\d+(?:[.,]\d+)?)\s+(unidades?|unidad|horas?|metros?|mts|kg|trabajos?)\s+(?:de\s+)?(.+)$/i);
  let quantity = 1;
  let unit = 'unidad';
  let description = working;
  if (quantityMatch?.[1] && quantityMatch[2] && quantityMatch[3]) {
    quantity = parseCommercialNumber(quantityMatch[1]) ?? 1;
    unit = /^u/i.test(quantityMatch[2]) ? 'unidad' : foldCommercialText(quantityMatch[2]);
    description = quantityMatch[3];
  }

  description = normalizeCommercialDescription(description);
  if (!description) return null;
  return {
    description,
    quantity,
    unit,
    unitPrice: money.amount,
    taxRate: 21,
    currency: money.currency
  };
}

export function extractDraftItems(content: string, inheritedCurrency?: CommercialCurrency) {
  return splitCommercialItems(content)
    .map((part) => parseItemPart(part, inheritedCurrency))
    .filter((item): item is DraftItemInput => Boolean(item));
}

function extractDeleteReference(message: string): ItemReference {
  const target = foldCommercialText(message)
    .replace(/^.*?\b(?:borra|elimina|saca|quita)\s+/, '')
    .replace(/^(?:que\s+)?/, '')
    .trim();
  return parseItemReference(target);
}

function extractPriceReference(message: string) {
  const explicit = referenceSegment(message);
  if (explicit) return parseItemReference(explicit);
  const folded = foldCommercialText(message);
  const after = folded.match(/\b(?:al|a el)\s+(primero|segundo|tercero|cuarto|\d+)\b/);
  if (after?.[1]) return parseItemReference(after[1]);
  const described = folded.match(/\bprecio\s+(?:(?:de|del|de la)\s+)?(.+?)\s+(?:a|por|en)\s+(?:\$|usd|u\$s|ars)?\s*[\d.,]+/);
  return parseItemReference(described?.[1] || '');
}

export function extractCommercialAction(
  classification: ActionClassification,
  message: string,
  draft?: CommercialDraft | null
): CommercialAction {
  const folded = foldCommercialText(message);
  switch (classification.type) {
    case 'START_DRAFT':
      return { type: 'START_DRAFT', documentType: /\bremito\b/.test(folded) ? 'DELIVERY_NOTE' : 'QUOTE' };
    case 'CANCEL_DRAFT':
      return { type: 'CANCEL_DRAFT' };
    case 'GREETING':
      return { type: 'GREETING' };
    case 'CONFIRM_DOCUMENT':
      return { type: 'CONFIRM_DOCUMENT', fileName: extractFileName(message) };
    case 'RENAME_DRAFT':
      return { type: 'RENAME_DRAFT', fileName: extractFileName(message) || '' };
    case 'GENERATE_PREVIEW':
      return { type: 'GENERATE_PREVIEW' };
    case 'SHOW_SUMMARY':
      return { type: 'SHOW_SUMMARY' };
    case 'SELECT_CUSTOMER': {
      const query = message
        .replace(/^.*?\b(?:cambia|cambiar|reemplaza|pone|poner)\s+(?:el\s+)?cliente\s+(?:a|por)\s+/i, '')
        .trim();
      return { type: 'SELECT_CUSTOMER', query };
    }
    case 'SELECT_CUSTOMER_CANDIDATE':
      return { type: 'SELECT_CUSTOMER_CANDIDATE', index: Number(folded) };
    case 'CLEAR_ITEMS':
      return { type: 'CLEAR_ITEMS' };
    case 'DELETE_ITEM':
      return { type: 'DELETE_ITEM', reference: extractDeleteReference(message) };
    case 'SET_ITEM_PRICE': {
      const money = parseMoneyExpression(message, { allowBare: true, inheritedCurrency: draft?.currency });
      return {
        type: 'SET_ITEM_PRICE',
        reference: extractPriceReference(message),
        unitPrice: money.amount ?? Number.NaN,
        currency: money.currency
      };
    }
    case 'SET_ITEM_QUANTITY': {
      const instead = folded.match(/\ben\s+vez\s+de\s+(?:\w+)\s+(.+?)\s+(?:pone|pon|coloca)\s+(\w+)\b/);
      if (instead?.[1] && instead[2]) {
        return {
          type: 'SET_ITEM_QUANTITY',
          reference: { kind: 'TEXT', query: instead[1] },
          quantity: parseCommercialNumber(instead[2]) ?? Number.NaN
        };
      }
      const amount = folded.match(/\b(?:a|por|en)\s+([\d.,]+|un|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/)?.[1];
      return {
        type: 'SET_ITEM_QUANTITY',
        reference: parseItemReference(referenceSegment(message)),
        quantity: amount ? parseCommercialNumber(amount) ?? Number.NaN : Number.NaN
      };
    }
    case 'REPLACE_ITEM_TEXT':
    case 'REPLACE_DESCRIPTION': {
      const match = message.match(/\b(?:cambia|reemplaza)\s+(.+?)\s+por\s+(.+)$/i);
      const targetText = match?.[1]?.trim() || '';
      const replacementText = match?.[2]?.trim() || '';
      return classification.type === 'REPLACE_DESCRIPTION'
        ? {
            type: 'REPLACE_DESCRIPTION',
            reference: { kind: 'TEXT', query: targetText },
            description: normalizeCommercialDescription(replacementText)
          }
        : {
            type: 'REPLACE_ITEM_TEXT',
            reference: { kind: 'TEXT', query: targetText },
            targetText,
            replacementText
          };
    }
    case 'APPEND_ITEM': {
      const content = extractCommercialContent(message, classification);
      const item = extractDraftItems(content, draft?.currency)[0];
      return item ? { type: 'APPEND_ITEM', item } : { type: 'AMBIGUOUS', reason: 'commercial_content_not_extracted' };
    }
    case 'BUSINESS_QUERY':
      return { type: 'BUSINESS_QUERY', query: message.trim() };
    case 'UNSUPPORTED':
      return { type: 'UNSUPPORTED', reason: classification.rule };
    default:
      return { type: 'AMBIGUOUS', reason: classification.rule };
  }
}
