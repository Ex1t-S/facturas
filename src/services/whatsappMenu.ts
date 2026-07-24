export type WhatsAppMenuMode = 'ROOT' | 'CUSTOMER_ADD' | 'DOCUMENT_QUERY';

export type WhatsAppMenuState = {
  mode: WhatsAppMenuMode;
  customerQuery?: string;
  date?: string;
};

export type WhatsAppMenuRoute = 'delivery_note' | 'quote' | 'customers' | 'document_query' | 'menu';

export const whatsappMainMenuInteractive = {
  type: 'list' as const,
  header: 'FMH Gesti\u00f3n',
  body: 'Eleg\u00ed qu\u00e9 quer\u00e9s hacer:',
  footer: 'Tambi\u00e9n pod\u00e9s escribir o enviar un audio.',
  button: 'Abrir men\u00fa',
  sections: [
    {
      title: 'Gesti\u00f3n comercial',
      rows: [
        { id: 'fmh_menu_remito', title: 'Remito', description: 'Crear y enviar un remito' },
        { id: 'fmh_menu_presupuesto', title: 'Presupuesto', description: 'Armar un presupuesto' },
        { id: 'fmh_menu_clientes', title: 'Clientes', description: 'Agregar o consultar clientes' },
        { id: 'fmh_menu_consultas', title: 'Consultas', description: 'Buscar remitos y presupuestos' }
      ]
    }
  ]
};

export const whatsappMainMenu = [
  'Menu FMH Gestion',
  '',
  '1. Remito',
  '   Envia un audio del remito o escribi los trabajos.',
  '2. Presupuesto',
  '   Armamos y revisamos tu presupuesto.',
  '3. Clientes',
  '   Agrega un cliente nuevo a la base.',
  '4. Consultas',
  '   Busca remitos o presupuestos por cliente y fecha.',
  '0. Volver al menu',
  '',
  'Responde con un numero o escribi la opcion.'
].join('\n');

export function normalizeWhatsAppMenuText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-AR')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isWhatsAppMenuRequest(value: string) {
  return /^(?:menu|inicio|opciones|volver|volver al menu|que puedo hacer|ayuda)[.!\s]*$/i.test(normalizeWhatsAppMenuText(value));
}

export function whatsappMenuSelection(value: string, state?: WhatsAppMenuState, history?: Array<{ role: string; content: string }>): WhatsAppMenuRoute | null {
  const normalized = normalizeWhatsAppMenuText(value);
  const interactiveSelections: Record<string, WhatsAppMenuRoute> = {
    fmh_menu_remito: 'delivery_note',
    fmh_menu_presupuesto: 'quote',
    fmh_menu_clientes: 'customers',
    fmh_menu_consultas: 'document_query'
  };
  if (interactiveSelections[normalized]) return interactiveSelections[normalized];
  if (/^(?:remito|crear remito|armar remito)$/.test(normalized)) return 'delivery_note';
  if (/^(?:presupuesto|crear presupuesto|armar presupuesto)$/.test(normalized)) return 'quote';
  if (/^(?:cliente|clientes|agregar cliente|nuevo cliente)$/.test(normalized)) return 'customers';
  if (/^(?:consulta|consultas|buscar documento|buscar remito|buscar presupuesto)$/.test(normalized)) return 'document_query';
  const latestAssistant = [...(history ?? [])].reverse().find((entry) => entry.role === 'assistant');
  const menuWasShown = state?.mode === 'ROOT' || latestAssistant?.content.includes('1. Remito') === true;
  if (!menuWasShown) return null;
  const selections: Record<string, WhatsAppMenuRoute> = {
    '0': 'menu',
    '1': 'delivery_note',
    '2': 'quote',
    '3': 'customers',
    '4': 'document_query'
  };
  if (selections[normalized]) return selections[normalized];
  return null;
}

export type WhatsAppCustomerInput = {
  legalName: string;
  cuit?: string;
  phone?: string;
  email?: string;
  address?: string;
};

function labeledValue(message: string, labels: string[]) {
  const pattern = new RegExp(`(?:${labels.join('|')})\\s*[:=-]?\\s*([^,;\\n]+)`, 'i');
  return message.match(pattern)?.[1]?.trim();
}

export function parseWhatsAppCustomerInput(message: string): WhatsAppCustomerInput | null {
  const text = message.trim();
  if (!text) return null;
  const legalName = labeledValue(text, ['nombre', 'cliente', 'razon social', 'razon'])
    || text.split(/[,;\n]/)[0]?.replace(/^(?:agregar|agrega|nuevo)\s+(?:cliente\s*)?/i, '').trim();
  if (!legalName) return null;
  const cuit = labeledValue(text, ['cuit'])?.replace(/\D/g, '') || undefined;
  const phone = labeledValue(text, ['telefono', 'tel', 'celular']) || undefined;
  const email = labeledValue(text, ['email', 'correo']) || undefined;
  const address = labeledValue(text, ['domicilio', 'direccion', 'dirección']) || undefined;
  return { legalName, cuit: cuit || undefined, phone, email, address };
}

export type WhatsAppDocumentQueryInput = {
  customerQuery?: string;
  date?: string;
};

export function parseWhatsAppDocumentQuery(message: string): WhatsAppDocumentQueryInput {
  const text = message.trim();
  const dateMatch = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/);
  const date = dateMatch
    ? `${dateMatch[3]!.length === 2 ? '20' : ''}${dateMatch[3]}-${dateMatch[2]!.padStart(2, '0')}-${dateMatch[1]!.padStart(2, '0')}`
    : undefined;
  const labeled = labeledValue(text, ['cliente', 'nombre', 'razon social']);
  const withoutDate = text.replace(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g, '').trim();
  const customerQuery = (labeled || withoutDate)
    ?.replace(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g, '')
    .replace(/\b(?:fecha|del|de)\s*$/i, '')
    ?.replace(/^(?:buscar|consulta|consultar|documentos?|remitos?|presupuestos?)\s*/i, '')
    .replace(/\b(?:de|del|para)\s*$/i, '')
    .trim();
  return { customerQuery: customerQuery || undefined, date };
}

export function menuState(mode: WhatsAppMenuMode, extra: Partial<WhatsAppMenuState> = {}): WhatsAppMenuState {
  return { mode, ...extra };
}
