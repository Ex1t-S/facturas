export type DocumentConversationAction =
  | 'START_DOCUMENT_DRAFT'
  | 'APPEND_TO_DOCUMENT_DRAFT'
  | 'UPDATE_DOCUMENT_DRAFT'
  | 'REQUEST_PREVIEW'
  | 'CONFIRM_DOCUMENT'
  | 'CANCEL_DOCUMENT'
  | 'ASK_DRAFT_STATUS'
  | 'QUERY'
  | 'UNSUPPORTED'
  | 'AMBIGUOUS'
  | 'OTHER';

export type DocumentConversationResolution = {
  action: DocumentConversationAction;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
};

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR').replace(/\s+/g, ' ').trim();
}

const previewRequest = /\b(listo|terminamos|preparamelo|preparalo|prepara(?:me)?(?:\s+el)?\s+pdf|haceme\s+el\s+pdf|(?:dame|pasame|mandame|enviame|quiero\s+que\s+me\s+pases)\s+(?:el\s+)?pdf(?:\s+final)?|mostrame\s+como\s+quedo|mandame\s+el\s+borrador|quiero\s+revisarlo)\b/i;
const reminderRequest = /\b(recorda(?:me|melo)?|recordatorio|avisame|avisa(?:me)?|alarma|agenda(?:me|lo)?|calendario|notifica(?:me)?)\b/i;
const unsupportedActionRequest = /\b(?:manda(?:le)?\s+un\s+mensaje|envia(?:le)?\s+un\s+(?:mensaje|whatsapp|correo)|llama(?:lo|la)?\s+por\s+telefono|hace\s+una\s+transferencia|transferi(?:le)?|paga(?:le)?|compra(?:me)?|saca(?:me)?\s+un\s+turno)\b/i;
const correctionRequest = /\b(perdon|en realidad|fueron|no eran|corregi|corregime|cambia|cambialo|reemplaza|borra|saca|elimina|quita|pone|precio|cantidad)\b/i;
const appendRequest = /\b(tambien|ademas|agregale|agrega|aparte|falto poner|pone ademas|en el mismo remito|eso tambien va)\b/i;
const workEvidence = /\b(cambiar|cambiamos|reparar|reparamos|revisar|revisamos|soldar|soldamos|fabricar|fabricamos|instalar|instalamos|retirar|retiramos|colocar|colocamos|atornillar|atornillamos|entregar|entregamos|llevar|llevamos|levantar|levantamos|limpiar|limpiamos|hicimos|realizamos|montaje|reparacion|soldadura|revision|rodamientos?|rulemanes?|sinfin|noria|cinta|silo|soporte|motoreductor|espira|cabezal)\b/i;
const businessQuery = /\b(stock|inventario|existencia|precio|precios|cliente|clientes|producto|productos|proveedor|proveedores|remitos?\s+pendientes|presupuestos?\s+(?:abiertos|pendientes|guardados)|documentos?\s+(?:guardados|de))\b/i;

export function resolveDocumentConversationMessage(input: {
  message: string;
  hasActiveDraft: boolean;
  waitingConfirmation?: boolean;
}): DocumentConversationResolution {
  const message = normalize(input.message);

  if (reminderRequest.test(message)) return { action: 'UNSUPPORTED', confidence: 'HIGH', reason: 'reminder_not_supported' };
  if (unsupportedActionRequest.test(message)) return { action: 'UNSUPPORTED', confidence: 'HIGH', reason: 'external_action_not_supported' };
  const classified = classifyCommercialAction(
    input.message,
    input.hasActiveDraft
      ? {
          status: input.waitingConfirmation ? 'WAITING_CONFIRMATION' : 'COLLECTING_ITEMS',
          awaiting: input.waitingConfirmation ? 'CONFIRMATION' : 'ITEMS'
        }
      : null
  );
  const deterministic: Partial<Record<typeof classified.type, DocumentConversationAction>> = {
    START_DRAFT: 'START_DOCUMENT_DRAFT',
    APPEND_ITEM: 'APPEND_TO_DOCUMENT_DRAFT',
    APPEND_ITEMS: 'APPEND_TO_DOCUMENT_DRAFT',
    DELETE_ITEM: 'UPDATE_DOCUMENT_DRAFT',
    CLEAR_ITEMS: 'UPDATE_DOCUMENT_DRAFT',
    REPLACE_ITEM_TEXT: 'UPDATE_DOCUMENT_DRAFT',
    REPLACE_DESCRIPTION: 'UPDATE_DOCUMENT_DRAFT',
    SET_ITEM_PRICE: 'UPDATE_DOCUMENT_DRAFT',
    SET_ITEM_QUANTITY: 'UPDATE_DOCUMENT_DRAFT',
    SET_CURRENCY: 'UPDATE_DOCUMENT_DRAFT',
    GENERATE_PREVIEW: 'REQUEST_PREVIEW',
    CONFIRM_DOCUMENT: 'CONFIRM_DOCUMENT',
    CANCEL_DRAFT: 'CANCEL_DOCUMENT',
    SHOW_SUMMARY: 'ASK_DRAFT_STATUS',
    BUSINESS_QUERY: 'QUERY'
  };
  const deterministicAction = deterministic[classified.type];
  if (deterministicAction && classified.rule !== 'commercial_content') {
    return {
      action: deterministicAction,
      confidence: classified.confidence,
      reason: classified.rule
    };
  }
  if (/^(?:cancelar(?:\s+el)?(?:\s+borrador)?|cancela|cancelalo|descartalo|reiniciar|reinicia|reset|salir|no[,.]?\s+deja(?:lo)?)$/i.test(message)) {
    return { action: 'CANCEL_DOCUMENT', confidence: 'HIGH', reason: 'explicit_cancel' };
  }
  if (/\b(?:cancela|cancelalo|descartalo|olvidalo|borra ese borrador|reiniciar|reinicia|reset|salir|salir del borrador|volver a empezar|arranquemos de nuevo|arranquemos de (?:0|cero)|empezar de nuevo|empezar de (?:0|cero)|empecemos de nuevo|empezamos de nuevo|empecemos de (?:0|cero)|empezamos de (?:0|cero)|borron y cuenta nueva|no lo guardes|no quiero guardarlo|no lo quiero guardar|no hace falta guardarlo|dejalo asi)\b/i.test(message)) return { action: 'CANCEL_DOCUMENT', confidence: 'HIGH', reason: 'explicit_cancel' };
  if (/\b(que tenes anotado|como va el remito|mostrame lo que anotaste)\b/i.test(message)) return { action: 'ASK_DRAFT_STATUS', confidence: 'HIGH', reason: 'explicit_status_request' };
  if (/^(?:(?:guardar|guardalo|confirmar|confirmalo)(?:\s+como\s+.+)?|dale|ok|confirmado|esta bien|asi esta bien)[.!\s]*$/i.test(message)) {
    return { action: 'CONFIRM_DOCUMENT', confidence: 'HIGH', reason: 'explicit_confirmation' };
  }
  if (input.waitingConfirmation && /^listo[.!\s]*$/i.test(message)) {
    return { action: 'CONFIRM_DOCUMENT', confidence: 'HIGH', reason: 'explicit_confirmation' };
  }
  if (previewRequest.test(message)) return { action: 'REQUEST_PREVIEW', confidence: 'HIGH', reason: 'explicit_preview_request' };
  if (/\b(?:haceme|armame|generame|preparame|crea(?:me)?)\b.*\b(remito|presupuesto)\b|\b(remito|presupuesto)\s+para\b/i.test(message)) {
    return { action: 'START_DOCUMENT_DRAFT', confidence: 'HIGH', reason: 'explicit_document_request' };
  }
  if (correctionRequest.test(message) && input.hasActiveDraft) return { action: 'UPDATE_DOCUMENT_DRAFT', confidence: 'HIGH', reason: 'explicit_correction' };
  if (appendRequest.test(message) && input.hasActiveDraft) return { action: 'APPEND_TO_DOCUMENT_DRAFT', confidence: 'HIGH', reason: 'explicit_append' };
  if ((businessQuery.test(message) && (/\?|\b(cuanto|cuantos|que|cual|cuales|hay|tenemos|mostra|busca|lista)\b/i.test(message))) || /^\s*(cuanto|cuantos|que|cual|cuales|hay|tenemos|stock|precio|lista|buscar|mostra)\b/i.test(message)) {
    return { action: 'QUERY', confidence: 'HIGH', reason: 'business_query' };
  }
  if (input.hasActiveDraft && workEvidence.test(message)) return { action: 'APPEND_TO_DOCUMENT_DRAFT', confidence: 'MEDIUM', reason: 'work_description' };
  if (input.hasActiveDraft) return { action: 'AMBIGUOUS', confidence: 'LOW', reason: 'active_draft_without_document_signal' };
  return { action: 'OTHER', confidence: 'LOW', reason: 'no_document_signal' };
}

export function unsupportedWhatsAppAnswer(reason?: string) {
  return reason === 'external_action_not_supported'
    ? 'Por ahora no puedo ejecutar esa acción externa. Puedo ayudarte con remitos, presupuestos o consultas internas.'
    : 'Por ahora no puedo crear recordatorios ni alarmas. Puedo ayudarte con remitos, presupuestos o consultas internas.';
}
import { classifyCommercialAction } from './commercialAssistant/actionClassifier.js';
