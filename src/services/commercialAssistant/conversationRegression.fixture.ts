export type RegressionTurn = {
  user: string;
  expected: {
    action?: string;
    state?: string;
    customerIncludes?: string;
    itemCount?: number;
    itemDescriptions?: string[];
    unitPrices?: Array<number | undefined>;
    requestedFileName?: string;
    preview?: boolean;
    finalized?: boolean;
  };
};

export const primaryWhatsAppRegression: RegressionTurn[] = [
  { user: 'Hola', expected: { state: 'IDLE' } },
  { user: 'Quiero armar un remito', expected: { action: 'START_DRAFT', state: 'COLLECTING_CUSTOMER', itemCount: 0 } },
  { user: 'Mario Alvarez', expected: { action: 'SELECT_CUSTOMER', state: 'COLLECTING_ITEMS', customerIncludes: 'Mario Alvarez', itemCount: 0 } },
  {
    user: 'Le mejoramos una batea y limpiamos los cabezales de una noria',
    expected: {
      action: 'APPEND_ITEM',
      state: 'READY_FOR_PREVIEW',
      customerIncludes: 'Mario Alvarez',
      itemCount: 2,
      itemDescriptions: ['Mejoramos una batea', 'Limpiamos los cabezales de una noria']
    }
  },
  {
    user: 'Pasame el PDF',
    expected: { action: 'GENERATE_PREVIEW', state: 'WAITING_CONFIRMATION', customerIncludes: 'Mario Alvarez', itemCount: 2, preview: true }
  },
  {
    user: 'guardalo como remito-mario-alvarez-2307',
    expected: {
      action: 'CONFIRM_DOCUMENT',
      state: 'FINALIZED',
      customerIncludes: 'Mario Alvarez',
      itemCount: 2,
      requestedFileName: 'remito-mario-alvarez-2307.pdf',
      finalized: true
    }
  }
];

export const mutationRegressionMessages = [
  'agrega que caminamos sobre un techo',
  'saca el ultimo punto',
  'saca que caminamos sobre un techo',
  'Techado de galpon con 14 metros',
  'Cambia 14 metros por 16 metros',
  'Cambia 16 metros por techado de galpon 14 metros',
  'resumen',
  'resumen PDF',
  'al item uno ponle 20000$',
  'cambia el precio del item 1 a 50000',
  'precio del item 2 a 20000',
  'pasame el pdf'
] as const;

export const quoteRegressionMessages = [
  'Presupuesto',
  'Emancipacion silo 500t 20000',
  'Armame un presupuesto para la emancipacion de un SILO 200T precio 20000$'
] as const;
