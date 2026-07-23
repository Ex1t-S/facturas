import type { CommercialDraft, DraftTransition } from './types.js';

function money(currency: string, amount: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  }).format(amount);
}

export function buildCommercialSummary(draft: CommercialDraft) {
  const label = draft.documentType === 'QUOTE' ? 'Presupuesto' : 'Remito';
  const lines = [
    `${label} en preparación`,
    '',
    `Cliente: ${draft.customerName || 'Pendiente'}`,
    `Moneda: ${draft.currency || 'Pendiente'}`,
    ''
  ];
  let total = 0;
  const missing: string[] = [];
  for (const item of draft.items) {
    const subtotal = item.unitPrice === undefined ? undefined : item.quantity * item.unitPrice;
    if (subtotal !== undefined) total += subtotal;
    else if (draft.documentType === 'QUOTE') missing.push(`Precio del ítem ${item.position}: ${item.description}`);
    lines.push(`${item.position}. ${item.description}`);
    lines.push(`   Cantidad: ${item.quantity} ${item.unit}`);
    lines.push(`   Precio unitario: ${item.unitPrice === undefined ? 'Pendiente' : money(draft.currency || 'ARS', item.unitPrice)}`);
    lines.push(`   Subtotal: ${subtotal === undefined ? 'Pendiente' : money(draft.currency || 'ARS', subtotal)}`);
    lines.push('');
  }
  lines.push(`Total conocido: ${money(draft.currency || 'ARS', total)}`);
  if (missing.length) {
    lines.push('', 'Falta completar:', ...missing.map((value) => `- ${value}`));
  } else {
    lines.push(`Estado: ${draft.status === 'WAITING_CONFIRMATION' ? 'esperando confirmación' : 'listo para generar PDF'}`);
  }
  return lines.join('\n').trim();
}

export function buildTransitionAnswer(transition: DraftTransition) {
  if (!transition.ok) return transition.message;
  if (transition.message) return transition.message;
  return buildCommercialSummary(transition.draft);
}
