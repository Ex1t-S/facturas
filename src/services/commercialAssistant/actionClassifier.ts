import type { ActionClassification, CommercialDraft } from './types.js';
import { normalizeCommercialMessage } from './normalizer.js';

const commercialContentSignals = /\b(?:agrega|agregale|anade|sumale|inclui|incluye|trabajo|trabajos|servicio|servicios|repar(?:ar|acion|acion)|mejor(?:ar|a)|limpi(?:ar|eza)|revis(?:ar|ion)|sold(?:ar|adura)|fabric(?:ar|acion)|instal(?:ar|acion)|mont(?:ar|aje)|techad(?:o|a)|galpon|batea|noria|silo|cabezal|rodamientos?|rulemanes?|motor(?:es)?|cinta|sinfin|estructura|chapa|perfil|kg|kilos?|metros?|unidades?|unidad|item|punto|renglon|linea|precio|importe|valor|\$|usd|u\$s|ars)\b/;

function socialText(folded: string) {
  const clean = folded.replace(/[!?.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(?:hola|holas|buenas?|buen dia|buenas tardes|buenas noches|gracias|muchas gracias|ok|okey|dale|si|no|bien|perfecto|genial|jaja|jajaja|como estas|que tal|necesito ayuda|ayuda|que podes hacer)$/.test(clean);
}

export function classifyCommercialAction(
  message: string,
  draft?: Pick<CommercialDraft, 'status' | 'awaiting'> | null
): ActionClassification {
  const { folded } = normalizeCommercialMessage(message);
  const active = Boolean(draft && !['FINALIZED', 'CANCELLED', 'EXPIRED'].includes(draft.status));
  const waitingConfirmation = draft?.status === 'WAITING_CONFIRMATION';

  if (/(?:^|\b)(?:cancelar(?:\s+el)?\s+borrador|cancela|cancelalo|descartalo|olvidalo|borra ese borrador|reiniciar|reinicia|reset|salir|salir del borrador|volver a empezar|arranquemos de nuevo|arranquemos de (?:0|cero)|empezar de nuevo|empezar de (?:0|cero)|empecemos de nuevo|empezamos de nuevo|empecemos de (?:0|cero)|empezamos de (?:0|cero)|borrón y cuenta nueva|borron y cuenta nueva|no lo guardes|no quiero guardarlo|no hace falta guardarlo|no[,.]?\s+deja(?:lo)?)(?:$|\b)/.test(folded)) {
    return { type: 'CANCEL_DRAFT', confidence: 'HIGH', rule: 'explicit_cancel' };
  }

  if (
    /^(?:guardar|guardalo|confirmar|confirmalo)(?:\s+como\s+.+)?[.! ]*$/.test(folded) ||
    (waitingConfirmation && /^(?:dale|ok|confirmado|esta bien|asi esta bien|listo)[.! ]*$/.test(folded))
  ) {
    return { type: 'CONFIRM_DOCUMENT', confidence: 'HIGH', rule: 'explicit_confirmation' };
  }

  if (active && socialText(folded)) {
    return { type: 'GREETING', confidence: 'HIGH', rule: 'social_message' };
  }

  if (/\b(?:cambia(?:r)?|modifica(?:r)?|renombra(?:r)?|renombralo|pone|pon)\s+(?:el\s+)?(?:nombre|archivo)\b/.test(folded)) {
    return { type: 'RENAME_DRAFT', confidence: 'HIGH', rule: 'rename' };
  }

  if (
    /\bresumen\s+(?:en\s+)?pdf\b/.test(folded) ||
    /\b(?:pasame|dame|mandame|enviame|mostrame|genera|generame|prepara|preparame|haceme)\b.*\bpdf\b/.test(folded) ||
    /^(?:pdf|preview|previsualizacion)[.! ]*$/.test(folded)
  ) {
    return { type: 'GENERATE_PREVIEW', confidence: 'HIGH', rule: 'preview' };
  }

  if (/^(?:resumen|estado|que tenes anotado|como va el remito|como va el presupuesto|mostrame lo que anotaste)[.! ]*$/.test(folded)) {
    return { type: 'SHOW_SUMMARY', confidence: 'HIGH', rule: 'summary' };
  }

  if (/\b(?:cambia|cambiar|reemplaza|pone|poner)\s+(?:el\s+)?cliente\s+(?:a|por)\b/.test(folded)) {
    return { type: 'SELECT_CUSTOMER', confidence: 'HIGH', rule: 'change_customer' };
  }

  if (/\b(?:borra|elimina|saca|quita)\s+(?:todos?\s+los\s+(?:items|puntos|renglones)|todo)\b/.test(folded)) {
    return { type: 'CLEAR_ITEMS', confidence: 'HIGH', rule: 'clear_items' };
  }

  if (/\b(?:borra|elimina|saca|quita)\b/.test(folded)) {
    return { type: 'DELETE_ITEM', confidence: 'HIGH', rule: 'delete_item' };
  }

  if (
    /\bprecio\b.*\b(?:item|punto|renglon|linea)\b/.test(folded) ||
    /\b(?:cambia|corrige|pone|pon)\s+(?:el\s+)?precio\b.*(?:\d|\bmil\b)/.test(folded) ||
    /\b(?:item|punto|renglon|linea)\b.*\b(?:ponle|ponele|pone|pon|precio)\b.*(?:\d|\b(?:cero|mil)\b)/.test(folded) ||
    /\bpone\s+(?:(?:usd|u\$s|ars|\$)\s*)?[\d.,]+\s*(?:mil|k)?\s*(?:usd|u\$s|ars|dolares?|pesos?|\$)?\s+(?:al|a el)\s+(?:(?:item\s*)?(?:primero|primer|segundo|tercero|cuarto|quinto|\d+)|(?:primero|primer|segundo|tercero|cuarto|quinto)\s+item)\b/.test(folded)
  ) {
    return { type: 'SET_ITEM_PRICE', confidence: 'HIGH', rule: 'set_price' };
  }

  if (/\ben\s+vez\s+de\b.+\b(?:pone|pon|coloca)\b/.test(folded) || /\b(?:cantidad|unidades?|metros?|kg)\b.*\b(?:item|punto|renglon|linea)\b|\b(?:cambia|corrige|pone|pon)\s+(?:la\s+)?cantidad\b/.test(folded)) {
    return { type: 'SET_ITEM_QUANTITY', confidence: 'HIGH', rule: 'set_quantity' };
  }

  const replacement = folded.match(/\b(?:cambia|reemplaza)\s+(.+?)\s+por\s+(.+)$/);
  if (replacement && !replacement[1]?.includes('cliente') && !replacement[1]?.includes('precio')) {
    const replacementWords = replacement[2]!.split(' ').filter(Boolean);
    return {
      type: replacementWords.length >= 4 ? 'REPLACE_DESCRIPTION' : 'REPLACE_ITEM_TEXT',
      confidence: 'HIGH',
      rule: replacementWords.length >= 4 ? 'replace_description_by_fragment' : 'replace_partial_text'
    };
  }

  if (/\b(?:descripcion|detalle)\s+(?:del\s+)?(?:item|punto|renglon|linea)\b/.test(folded)) {
    return { type: 'REPLACE_DESCRIPTION', confidence: 'HIGH', rule: 'replace_description' };
  }

  if (/^(?:agrega|agregale|anade|sumale|inclui|incluye|tambien|ademas)\b/.test(folded)) {
    return { type: 'APPEND_ITEM', confidence: 'HIGH', rule: 'explicit_append' };
  }

  if (
    /^(?:presupuesto|remito)[.! ]*$/.test(folded) ||
    /\b(?:quiero|ahora)?\s*(?:armar|armame|hacer|haceme|crear|creame|preparar|preparame|generar|generame)\b.*\b(?:presupuesto|remito)\b/.test(folded) ||
    /\b(?:presupuesto|remito)\s+para\b/.test(folded)
  ) {
    return { type: 'START_DRAFT', confidence: 'HIGH', rule: 'start_draft' };
  }

  if (draft?.status === 'SELECTING_CUSTOMER' && /^\d+$/.test(folded)) {
    return { type: 'SELECT_CUSTOMER_CANDIDATE', confidence: 'HIGH', rule: 'expected_customer_candidate' };
  }

  if (draft?.status === 'COLLECTING_CUSTOMER' || draft?.awaiting === 'CUSTOMER') {
    return { type: 'SELECT_CUSTOMER', confidence: 'MEDIUM', rule: 'expected_customer' };
  }

  if (
    active &&
    /\b(?:stock|inventario|existencia|clientes?|productos?|proveedores?|remitos?\s+pendientes|presupuestos?\s+(?:abiertos|guardados))\b/.test(folded) &&
    /\b(?:cuanto|cuantos|que|cual|hay|tenemos|mostra|busca|lista)\b/.test(folded)
  ) {
    return { type: 'BUSINESS_QUERY', confidence: 'HIGH', rule: 'business_query' };
  }

  if (
    active &&
    ['COLLECTING_ITEMS', 'COLLECTING_PRICES', 'READY_FOR_PREVIEW', 'WAITING_CONFIRMATION'].includes(draft!.status) &&
    folded.length >= 3 &&
    commercialContentSignals.test(folded)
  ) {
    return { type: 'APPEND_ITEM', confidence: draft?.awaiting === 'ITEMS' ? 'HIGH' : 'MEDIUM', rule: 'commercial_content' };
  }

  return { type: 'AMBIGUOUS', confidence: 'LOW', rule: active ? 'active_draft_ambiguous' : 'no_commercial_signal' };
}
