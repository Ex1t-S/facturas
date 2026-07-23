export type CommercialDocumentType = 'QUOTE' | 'DELIVERY_NOTE';
export type CommercialCurrency = 'ARS' | 'USD';

export type CommercialConversationState =
  | 'IDLE'
  | 'SELECTING_DOCUMENT_TYPE'
  | 'COLLECTING_CUSTOMER'
  | 'SELECTING_CUSTOMER'
  | 'COLLECTING_ITEMS'
  | 'COLLECTING_PRICES'
  | 'READY_FOR_PREVIEW'
  | 'WAITING_CONFIRMATION'
  | 'FINALIZED'
  | 'CANCELLED'
  | 'EXPIRED';

export type CommercialAwaiting =
  | 'DOCUMENT_TYPE'
  | 'CUSTOMER'
  | 'CUSTOMER_SELECTION'
  | 'ITEMS'
  | 'PRICES'
  | 'CONFIRMATION';

export type ItemReference =
  | { kind: 'INDEX'; index: number }
  | { kind: 'FIRST' }
  | { kind: 'LAST' }
  | { kind: 'LINE_ID'; lineId: string }
  | { kind: 'TEXT'; query: string };

export type DraftItemInput = {
  description: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  taxRate?: number;
  currency?: CommercialCurrency;
  sourceMessageId?: string;
};

export type CommercialDraftItem = {
  lineId: string;
  position: number;
  description: string;
  quantity: number;
  unit: string;
  unitPrice?: number;
  taxRate?: number;
  sourceMessageId?: string;
};

export type CommercialCustomer = {
  id: string;
  legalName: string;
  tradeName?: string | null;
  cuit?: string | null;
  address?: string | null;
};

export type CommercialDraft = {
  schemaVersion: 2;
  id: string;
  conversationId: string;
  companyId: string;
  documentType: CommercialDocumentType;
  status: CommercialConversationState;
  customerId?: string;
  customerName?: string;
  customerSearchQuery?: string;
  customerCandidates?: CommercialCustomer[];
  currency?: CommercialCurrency;
  items: CommercialDraftItem[];
  suggestedFileName: string;
  requestedFileName?: string;
  draftVersion: number;
  previewVersion?: number;
  previewStoragePath?: string;
  previewFileName?: string;
  previewMimeType?: string;
  awaiting?: CommercialAwaiting;
  finalDocumentId?: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
};

export type CommercialAction =
  | { type: 'START_DRAFT'; documentType: CommercialDocumentType }
  | { type: 'SELECT_CUSTOMER'; query: string; customer?: CommercialCustomer }
  | { type: 'SELECT_CUSTOMER_CANDIDATE'; index: number; customer?: CommercialCustomer }
  | { type: 'SET_CUSTOMER_CANDIDATES'; query: string; candidates: CommercialCustomer[] }
  | { type: 'APPEND_ITEM'; item: DraftItemInput }
  | { type: 'APPEND_ITEMS'; items: DraftItemInput[] }
  | { type: 'DELETE_ITEM'; reference: ItemReference }
  | { type: 'CLEAR_ITEMS' }
  | { type: 'REPLACE_ITEM_TEXT'; reference: ItemReference; targetText: string; replacementText: string }
  | { type: 'REPLACE_DESCRIPTION'; reference: ItemReference; description: string }
  | { type: 'SET_ITEM_PRICE'; reference: ItemReference; unitPrice: number; currency?: CommercialCurrency }
  | { type: 'SET_ITEM_QUANTITY'; reference: ItemReference; quantity: number }
  | { type: 'SET_CURRENCY'; currency: CommercialCurrency }
  | { type: 'SHOW_SUMMARY' }
  | { type: 'GENERATE_PREVIEW' }
  | { type: 'RENAME_DRAFT'; fileName: string }
  | { type: 'CONFIRM_DOCUMENT'; fileName?: string }
  | { type: 'CANCEL_DRAFT' }
  | { type: 'BUSINESS_QUERY'; query: string }
  | { type: 'AMBIGUOUS'; reason: string }
  | { type: 'UNSUPPORTED'; reason: string }
  | {
      type: 'PREVIEW_GENERATED';
      draftVersion: number;
      storagePath: string;
      fileName: string;
      mimeType: string;
    }
  | { type: 'DOCUMENT_FINALIZED'; documentId: string };

export type CommercialActionType = CommercialAction['type'];

export type ActionClassification = {
  type: CommercialActionType;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  rule: string;
};

export type CommercialEffect =
  | { type: 'GENERATE_PREVIEW'; draftId: string; draftVersion: number; fileName: string }
  | { type: 'FINALIZE_DOCUMENT'; draftId: string; draftVersion: number; fileName: string }
  | { type: 'ANSWER_BUSINESS_QUERY'; query: string };

export type TransitionErrorCode =
  | 'INVALID_STATE'
  | 'VERSION_CONFLICT'
  | 'CUSTOMER_REQUIRED'
  | 'ITEMS_REQUIRED'
  | 'ITEM_NOT_FOUND'
  | 'ITEM_REFERENCE_AMBIGUOUS'
  | 'MISSING_PRICES'
  | 'CURRENCY_REQUIRED'
  | 'STALE_PREVIEW'
  | 'INVALID_FILE_NAME'
  | 'ACTIVE_DRAFT_CONFLICT'
  | 'CUSTOMER_NOT_FOUND'
  | 'CUSTOMER_AMBIGUOUS';

export type DraftTransition =
  | {
      ok: true;
      previous: CommercialDraft | null;
      draft: CommercialDraft;
      effects: CommercialEffect[];
      changed: boolean;
      message?: string;
    }
  | {
      ok: false;
      draft: CommercialDraft | null;
      code: TransitionErrorCode;
      message: string;
      details?: unknown;
    };

export type TransitionContext = {
  companyId: string;
  conversationId: string;
  expectedDraftVersion?: number;
  messageId?: string;
  companyDefaultCurrency?: CommercialCurrency;
  now?: Date;
  createId?: () => string;
};

export type CommercialProcessResult = {
  handled: boolean;
  classification: ActionClassification;
  action: CommercialAction;
  draft: CommercialDraft | null;
  answer: string;
  preview?: {
    buffer?: Buffer;
    storagePath: string;
    fileName: string;
    mimeType: string;
  };
  documentId?: string;
  errorCode?: TransitionErrorCode;
};

export type CommercialOrchestratorAdapters = {
  customers: CommercialCustomer[];
  defaultCurrency?: CommercialCurrency;
  createId?: () => string;
  now?: () => Date;
  generatePreview?: (draft: CommercialDraft, fileName: string) => Promise<{
    buffer?: Buffer;
    storagePath: string;
    fileName: string;
    mimeType: string;
  }>;
  finalizeDocument?: (draft: CommercialDraft, fileName: string) => Promise<{ documentId: string }>;
};
