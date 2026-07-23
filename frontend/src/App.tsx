import { useEffect, useMemo, useState } from 'react';
import { Archive, ArrowRight, Bot, Building2, CheckCircle2, ChevronDown, ChevronRight, CircleDot, ClipboardList, Clock3, FileCheck2, FileText, Folder, FolderOpen, Home, Menu, MessageSquareText, PackageSearch, Plus, ReceiptText, Search, Send, Settings, ShieldCheck, Upload, Users, Wrench, X } from 'lucide-react';
import { api, dateFmt, money, postJson } from './api';
import { EngineeringPage } from './features/engineering/EngineeringPage';

type View = 'dashboard' | 'assistant' | 'engineering' | 'documents' | 'delivery-notes' | 'quotes' | 'invoices' | 'inventory' | 'customers' | 'whatsapp' | 'settings';
type AnyRecord = Record<string, any>;

const navGroups: Array<{ label: string; items: Array<{ id: View; label: string; icon: typeof Home }> }> = [
  {
    label: 'Operación',
    items: [
      { id: 'dashboard', label: 'Resumen', icon: Home },
      { id: 'delivery-notes', label: 'Remitos', icon: ClipboardList },
      { id: 'quotes', label: 'Presupuestos', icon: ReceiptText },
      { id: 'invoices', label: 'Facturación', icon: FileCheck2 },
      { id: 'documents', label: 'Documentos', icon: Archive }
    ]
  },
  {
    label: 'Gestión',
    items: [
      { id: 'customers', label: 'Clientes', icon: Users },
      { id: 'inventory', label: 'Materiales y costos', icon: PackageSearch },
      { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquareText }
    ]
  },
  {
    label: 'Herramientas',
    items: [
      { id: 'assistant', label: 'Asistente comercial', icon: Bot },
      { id: 'engineering', label: 'Ingeniería FMH', icon: Wrench },
      { id: 'settings', label: 'Configuración', icon: Settings }
    ]
  }
];
const nav = navGroups.flatMap((group) => group.items);

const documentKinds = [
  ['', 'Todos'],
  ['QUOTE', 'Presupuestos'],
  ['INVOICE', 'Facturas'],
  ['DELIVERY_NOTE', 'Remitos'],
  ['PURCHASE_INVOICE', 'Facturas compra'],
  ['UNKNOWN', 'Sin tipo']
];

const labels: Record<string, string> = {
  DRAFT: 'Borrador',
  SENT: 'Enviado',
  ACCEPTED: 'Aceptado',
  REJECTED: 'Rechazado',
  EXPIRED: 'Vencido',
  INVOICED: 'Facturado',
  PENDING_REVIEW: 'Pendiente de revision',
  REVIEWED: 'Revisado',
  QUOTE: 'Presupuesto',
  INVOICE: 'Factura',
  PURCHASE_INVOICE: 'Factura compra',
  DELIVERY_NOTE: 'Remito',
  UNKNOWN: 'Sin tipo',
  UPLOADED: 'Subido',
  TEXT_EXTRACTED: 'Texto extraido',
  STRUCTURED: 'Estructurado',
  NEEDS_REVIEW: 'Revisar',
  APPROVED: 'Aprobado',
  APPLIED: 'Aplicado',
  FAILED: 'Fallido',
  PRODUCT: 'Componente/equipo',
  MATERIAL: 'Material',
  SERVICE: 'Trabajo',
  customer: 'Cliente',
  product: 'Producto',
  supplierPrice: 'Precio proveedor',
  quote: 'Presupuesto',
  document: 'Documento',
  local: 'Modo local',
  openai: 'IA remota',
  catalog: 'Catalogo',
  scrape: 'Web publica',
  manual_quote: 'Presupuesto manual',
  received: 'Recibido',
  text: 'Texto',
  document_message: 'Documento',
  PRELIMINARY_DESIGN: 'Predimensionamiento preliminar',
  SUPPORTED_DETERMINISTIC: 'Cálculo realizado por el sistema',
  PRELIMINARY_ASSISTED: 'Análisis preliminar',
  CRITICAL: 'Necesario para continuar',
  IMPORTANT: 'Importante',
  OPTIONAL: 'Opcional',
  CURRENT: 'Versión comprobada',
  HISTORICAL: 'Precio histórico',
  NO_PRICE: 'Sin precio',
  OK: 'Verificado',
  'Falta config': 'Pendiente de configuración',
  'Falta token': 'Pendiente de configuración',
  COMPLETO: 'Completo',
  PENDING_CONFIRMATION: 'Pendiente de confirmación',
  AUTHORIZED: 'Autorizada',
  CANCELLED: 'Cancelada',
  DRAWING: 'Plano',
  EXTRACTED: 'Procesado',
  INDEXED: 'Indexado',
  UNSUPPORTED: 'No compatible',
  ORIENTATION: 'Orientación'
};

function labelFor(value?: string) {
  if (!value) return 'Sin estado';
  return labels[value] || labels[value.toLowerCase()] || value;
}

function useHashView() {
  const [view, setView] = useState<View>((location.hash.replace('#/', '') as View) || 'dashboard');
  useEffect(() => {
    const listener = () => setView((location.hash.replace('#/', '') as View) || 'dashboard');
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);
  return [view, (next: View) => {
    history.replaceState(null, '', `#/${next}`);
    setView(next);
  }] as const;
}

function Badge({ value }: { value?: string }) {
  const normalized = String(value || '').toUpperCase();
  const tone = normalized.includes('FAIL') || normalized.includes('REJECT') || normalized.includes('CANCEL')
    ? 'danger'
    : normalized.includes('PENDING') || normalized.includes('NEEDS') || normalized.includes('UPLOADED')
      ? 'warn'
      : normalized.includes('DRAFT') || normalized.includes('UNKNOWN')
        ? 'neutral'
        : 'ok';
  return <span className={`badge ${tone}`}>{labelFor(value)}</span>;
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className="empty"><span className="emptyGlyph"><CircleDot size={18} /></span><strong>{title}</strong><span>{text}</span></div>;
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...inputProps } = props;
  return <label className="field"><span>{label}</span><input {...inputProps} /></label>;
}

function SelectField(props: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: React.ReactNode }) {
  const { label, children, ...selectProps } = props;
  return <label className="field"><span>{label}</span><select {...selectProps}>{children}</select></label>;
}

function Table({ headers, rows }: { headers: string[]; rows: React.ReactNode[] }) {
  if (!rows.length) return <Empty title="Sin datos" text="Todavía no hay registros para mostrar." />;
  return (
    <div className="tableWrap">
      <table>
        <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

function queryString(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value));
  });
  return search.toString();
}

export function App() {
  const [view, setView] = useHashView();
  const [companyId, setCompanyId] = useState(localStorage.getItem('companyId') || '');
  const [data, setData] = useState<AnyRecord>({});
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const companyName = data.dashboard?.company?.tradeName || data.dashboard?.company?.legalName || 'Sin empresa';
  const goTo = (next: View) => { setView(next); setSidebarOpen(false); };

  async function notify<T>(message: string, work: () => Promise<T>) {
    setBusy(true);
    try {
      const result = await work();
      setToast(message);
      setTimeout(() => setToast(''), 2800);
      await load();
      return result;
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'No pudimos completar la acción. Revisá los datos e intentá nuevamente.');
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    const dashboard = await api<AnyRecord>(`/api/dashboard${companyId ? `?companyId=${companyId}` : ''}`);
    const activeCompanyId = dashboard.company?.id || companyId;
    if (activeCompanyId) localStorage.setItem('companyId', activeCompanyId);
    setCompanyId(activeCompanyId);
    if (!activeCompanyId) { setData((current) => ({ ...current, dashboard })); return; }
    const next: AnyRecord = { dashboard };
    if (view === 'quotes' || view === 'customers' || view === 'delivery-notes') next.customers = await api<AnyRecord[]>(`/api/customers?companyId=${activeCompanyId}`);
    if (view === 'quotes' || view === 'inventory') next.products = await api<AnyRecord[]>(`/api/products?companyId=${activeCompanyId}&take=300`);
    if (view === 'quotes' || view === 'invoices') next.quotes = await api<AnyRecord[]>(`/api/quotes?companyId=${activeCompanyId}`);
    if (view === 'invoices') next.invoices = await api<AnyRecord[]>(`/api/invoices?companyId=${activeCompanyId}`);
    if (view === 'documents') next.documents = await api<AnyRecord[]>(`/api/documents?companyId=${activeCompanyId}&take=300`);
    if (view === 'delivery-notes') next.deliveryNotes = await api<AnyRecord[]>(`/api/delivery-notes?companyId=${activeCompanyId}`);
    if (view === 'inventory') next.inventory = await api<AnyRecord>(`/api/inventory?companyId=${activeCompanyId}`);
    if (view === 'inventory') next.suppliers = await api<AnyRecord[]>(`/api/suppliers?companyId=${activeCompanyId}`);
    if (view === 'whatsapp') next.whatsapp = await api<AnyRecord[]>(`/api/whatsapp/messages?companyId=${activeCompanyId}`);
    setData((current) => ({ ...current, ...next }));
  }

  useEffect(() => {
    load().catch(() => setToast('No pudimos cargar la información. Intentá recargar la pantalla.'));
  }, [companyId, view]);

  const content = useMemo(() => {
    if (view === 'documents') return <Documents data={data} companyId={companyId} notify={notify} />;
    if (view === 'delivery-notes') return <DeliveryNotes data={data} companyId={companyId} notify={notify} />;
    if (view === 'assistant') return <AssistantView companyId={companyId} />;
    if (view === 'engineering') return <EngineeringPage companyId={companyId} />;
    if (view === 'quotes') return <Quotes data={data} companyId={companyId} notify={notify} />;
    if (view === 'invoices') return <Invoices data={data} companyId={companyId} notify={notify} />;
    if (view === 'inventory') return <Inventory data={data} companyId={companyId} notify={notify} />;
    if (view === 'customers') return <CustomersDirectory data={data} companyId={companyId} notify={notify} />;
    if (view === 'whatsapp') return <WhatsAppInbox data={data} companyId={companyId} notify={notify} />;
    if (view === 'settings') return <SettingsCenter data={data} companyId={companyId} notify={notify} />;
    return <DashboardOverview data={data} setView={setView} />;
  }, [view, data, companyId]);

  return (
    <div className="shell">
      <button className="mobileSidebarBackdrop" aria-label="Cerrar navegación" onClick={() => setSidebarOpen(false)} />
      <aside className={`appSidebar ${sidebarOpen ? 'open' : ''}`}>
        <button className="iconButton sidebarClose" onClick={() => setSidebarOpen(false)} aria-label="Cerrar navegación"><X size={17} /></button>
        <div className="brand">
          <span className="brandLogo"><img src="/ui-assets/fmh-logo-green.png" alt="FMH" /></span>
          <span className="brandCopy"><strong>Gestión</strong><small>Operaciones metalúrgicas</small></span>
        </div>
        <div className="sidebarWorkspace"><Building2 size={15} /><span><small>Empresa activa</small><strong>{companyName}</strong></span></div>
        <nav className="appNav" aria-label="Navegación principal">
          {navGroups.map((group) => <div className="navGroup" key={group.label}><span className="navGroupLabel">{group.label}</span>{group.items.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => goTo(id)} aria-current={view === id ? 'page' : undefined}><Icon size={16} /><span>{label}</span>{view === id && <span className="navActiveMarker" />}</button>)}</div>)}
        </nav>
        <div className="sidebarBottom"><span className="sidebarStatus"><span /> Servicio disponible</span><span className="sidebarSecurity"><ShieldCheck size={13} /> Acceso protegido</span></div>
      </aside>
      <main>
        <header className="topbar">
          <button className="mobileSidebarToggle" onClick={() => setSidebarOpen(true)} aria-label="Abrir navegación"><Menu size={18} /></button>
          <div className="topbarContext"><span>FMH Gestión</span><ChevronRight size={14} /><strong>{nav.find((item) => item.id === view)?.label || 'Resumen'}</strong></div>
          <div className="topbarActions"><span className="topbarDate">{new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</span><button className="userMenu" onClick={() => goTo('settings')} aria-label="Abrir configuración"><span>FM</span></button></div>
        </header>
        {busy && <div className="globalProgress"><span />Procesando tu solicitud…</div>}
        {content}
      </main>
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  );
}

function Page({ title, text, action, eyebrow, children }: { title: string; text: string; eyebrow?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <div className="page"><div className="pageHead"><div className="pageTitleBlock">{eyebrow && <span className="pageEyebrow">{eyebrow}</span>}<h1>{title}</h1><p>{text}</p></div>{action && <div className="pageActions">{action}</div>}</div><div className="pageBody">{children}</div></div>;
}

function Dashboard({ data, setView }: { data: AnyRecord; setView: (view: View) => void }) {
  const stats = data.dashboard?.stats || {};
  return (
    <Page title="Panel operativo" text="Revisá documentos, presupuestos, precios y tareas pendientes." action={<button onClick={() => setView('documents')}>Importar históricos</button>}>
      <section className="metrics">
        <article><span>Clientes</span><strong>{stats.customers || 0}</strong></article>
        <article><span>Productos</span><strong>{stats.products || 0}</strong></article>
        <article><span>Presupuestos</span><strong>{stats.quotes || 0}</strong></article>
        <article><span>Documentos por revisar</span><strong>{stats.documentsPending || 0}</strong></article>
      </section>
      <section className="grid two">
        <div className="card"><h2>Presupuestos recientes</h2><Table headers={['N°', 'Cliente', 'Estado', 'Total']} rows={(data.dashboard?.recentQuotes || []).map((q: AnyRecord) => <tr key={q.id}><td>#{q.number}</td><td>{q.customer.legalName}</td><td><Badge value={q.status} /></td><td>{money.format(Number(q.total))}</td></tr>)} /></div>
        <div className="card"><h2>Documentos recientes</h2><Table headers={['Archivo', 'Tipo', 'Estado']} rows={(data.dashboard?.recentDocuments || []).map((d: AnyRecord) => <tr key={d.id}><td>{d.fileName}</td><td><Badge value={d.kind} /></td><td><Badge value={d.extractionStatus} /></td></tr>)} /></div>
      </section>
    </Page>
  );
}

function AssistantView({ companyId }: { companyId: string }) {
  const [chats, setChats] = useState<AnyRecord[]>([]);
  const [activeChatId, setActiveChatId] = useState('');
  const [messages, setMessages] = useState<Array<{ id?: string; role: 'user' | 'assistant'; content: string; mode?: string; sources?: AnyRecord[]; actionType?: string; documentId?: string }>>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  async function loadChats(selectFirst = false) {
    if (!companyId) return;
    const rows = await api<AnyRecord[]>(`/api/assistant/chats?companyId=${companyId}`);
    setChats(rows);
    if (selectFirst && rows[0] && !activeChatId) setActiveChatId(rows[0].id);
  }

  async function loadMessages(chatId: string) {
    if (!chatId) return;
    const chat = await api<AnyRecord>(`/api/assistant/chats/${chatId}/messages?companyId=${encodeURIComponent(companyId)}`);
    setMessages(chat.messages || []);
  }

  async function createChat() {
    if (!companyId) return '';
    const chat = await postJson<AnyRecord>('/api/assistant/chats', { companyId });
    setChats((current) => [chat, ...current]);
    setActiveChatId(chat.id);
    setMessages([]);
    return chat.id as string;
  }

  useEffect(() => {
    loadChats(true).catch(() => undefined);
  }, [companyId]);

  useEffect(() => {
    if (activeChatId) loadMessages(activeChatId).catch(() => undefined);
  }, [activeChatId]);

  async function ask(message: string) {
    if (!message.trim()) return;
    const chatId = activeChatId || (await createChat());
    if (!chatId) return;
    const localUserMessage = { role: 'user' as const, content: message.trim() };
    setMessages((current) => [...current, localUserMessage]);
    setText('');
    setLoading(true);
    try {
      const response = await postJson<{ assistantMessage: { role: 'assistant'; content: string; id?: string }; userMessage: { role: 'user'; content: string; id?: string } }>(`/api/assistant/chats/${chatId}/messages`, {
        companyId,
        message
      });
      setMessages((current) => {
        const withoutLocal = current.filter((item) => item !== localUserMessage);
        return [...withoutLocal, response.userMessage, response.assistantMessage];
      });
      await loadChats();
    } catch (error) {
      setMessages((current) => [...current, { role: 'assistant', content: error instanceof Error ? error.message : 'No pude responder.' }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Page eyebrow="Operación asistida" title="Asistente comercial" text="Consultá información del negocio y prepará documentos desde un único lugar.">
      <section className="assistantLayout">
        <aside className="assistantHistory">
          <button type="button" className="newChatButton" onClick={() => createChat()}><Bot size={16} /> Nuevo chat</button>
          <div className="chatList">
            {chats.map((chat) => (
              <button type="button" key={chat.id} className={chat.id === activeChatId ? 'active' : ''} onClick={() => setActiveChatId(chat.id)}>
                <strong>{chat.title}</strong>
                <span>{chat.lastMessage?.content || 'Sin mensajes'}</span>
                <small>{chat.updatedAt ? dateFmt.format(new Date(chat.updatedAt)) : ''}</small>
              </button>
            ))}
            {!chats.length && <div className="empty"><strong>Sin chats</strong><span>Creá una conversación para empezar.</span></div>}
          </div>
        </aside>
        <div className="assistantChatPanel">
           <div className="chat">
             {!messages.length && !loading && <div className="assistantWelcome"><span className="assistantWelcomeIcon"><ClipboardList size={22} /></span><span className="pageEyebrow">Centro operativo</span><strong>Iniciá una gestión</strong><p>Revisá pendientes, localizá documentación o prepará un borrador comercial con la información de FMH.</p><div className="assistantSuggestions"><button type="button" onClick={() => setText('¿Qué documentos tengo pendientes de revisar?')}>Revisar pendientes</button><button type="button" onClick={() => setText('Prepará un presupuesto para un cliente')}>Preparar presupuesto</button><button type="button" onClick={() => setText('Buscá un documento por cliente')}>Localizar documento</button></div></div>}
            {messages.map((message, index) => (
              <div className={`bubble ${message.role}`} key={message.id || index}>
                <span>{message.role === 'assistant' ? 'Asistente' : 'Vos'}</span>
                <p>{message.content}</p>
                {message.documentId && (message.actionType === 'delivery_note_created' || message.actionType === 'quote_draft_created') && (
                  <div className="messageActions">
                    <a href={`/api/documents/${message.documentId}/content?companyId=${encodeURIComponent(companyId)}`} target="_blank"><FileText size={16} /> Ver PDF</a>
                  </div>
                )}
              </div>
            ))}
             {loading && <div className="processingMessage"><span className="assistantAvatar"><Bot size={14} /></span><div><strong>Analizando tu solicitud</strong><span className="processingDots"><i /><i /><i /></span></div></div>}
          </div>
          <form className="chatComposer" onSubmit={(event) => { event.preventDefault(); ask(text); }}>
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} placeholder="Escribí la consulta o el pedido…" aria-label="Consulta o pedido comercial" />
            <button disabled={loading || !text.trim()}><Send size={16} />Enviar</button>
          </form>
        </div>
      </section>
    </Page>
  );
}

function EngineeringWorkspaceView({ companyId }: { companyId: string }) {
  const [message, setMessage] = useState('');
  const [conversations, setConversations] = useState<AnyRecord[]>([]);
  const [conversation, setConversation] = useState<AnyRecord | null>(null);
  const [library, setLibrary] = useState(false);
  const [drawings, setDrawings] = useState(false);
  const [loading, setLoading] = useState(false);

  async function loadConversations() {
    if (!companyId) return;
    setConversations(await api<AnyRecord[]>(`/api/engineering/conversations?companyId=${companyId}`));
  }
  useEffect(() => { loadConversations().catch(() => undefined); }, [companyId]);
  async function newConversation() {
    const created = await postJson<AnyRecord>('/api/engineering/conversations', { companyId });
    setConversations((current) => [created, ...current]);
    setConversation({ ...created, messages: [] });
  }
  async function openConversation(id: string) {
    const loaded = await api<AnyRecord>(`/api/engineering/conversations/${id}?companyId=${companyId}`);
    let state = {};
    try { state = loaded.stateJson ? JSON.parse(loaded.stateJson) : {}; } catch { state = {}; }
    setConversation({ ...loaded, state });
  }
  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim() || !companyId) return;
    const active = conversation || (await postJson<AnyRecord>('/api/engineering/conversations', { companyId }));
    if (!conversation) {
      setConversation({ ...active, messages: [] });
      setConversations((current) => [active, ...current]);
    }
    setLoading(true);
    try {
      const response = await postJson<AnyRecord>(`/api/engineering/conversations/${active.id}/messages`, { companyId, message });
      setConversation((current) => current ? { ...current, messages: [...(current.messages || []), response.userMessage, response.assistantMessage], state: response.state } : current);
      setMessage('');
      await loadConversations();
    } finally {
      setLoading(false);
    }
  }
  async function saveCase() {
    if (conversation) await postJson(`/api/engineering/conversations/${conversation.id}/save-case`, { companyId });
  }
  async function downloadDrawing() {
    const state = conversation?.state || {};
    const inputs = state.knownInputs || [];
    const value = (key: string) => inputs.find((item: AnyRecord) => item.key === key && item.status !== 'SUPERSEDED')?.value;
    const type = state.projectType === 'HOPPER' ? 'HOPPER' : state.projectType === 'WAREHOUSE' ? 'WAREHOUSE' : 'SILO';
    const response = await postJson<AnyRecord>('/api/engineering/drawing', { drawingType: type, diameter: Number(value('diameter')) || undefined, bodyHeight: Number(value('bodyHeight')) || undefined, coneHeight: Number(value('coneHeight')) || undefined, width: Number(value('width')) || undefined, length: Number(value('length')) || undefined, height: Number(value('height')) || undefined, freeHeight: Number(value('freeHeight')) || undefined, capacityT: Number(value('capacity')) || undefined, supportCount: Number(value('supportCount')) || undefined, notes: ['Generado desde el caso conversacional FMH'] });
    const url = URL.createObjectURL(new Blob([response.svg], { type: 'image/svg+xml' }));
    const link = document.createElement('a'); link.href = url; link.download = 'esquema-preliminar-fmh.svg'; link.click(); URL.revokeObjectURL(url);
  }
  const messages = conversation?.messages || [];
  return <Page title="Ingeniería FMH" text="Asistente técnico conversacional con memoria, cálculos y antecedentes trazables.">
    <div className="engineeringTabs"><button className={!library ? 'active' : ''} onClick={() => setLibrary(false)}>Asistente</button><button className={library ? 'active' : ''} onClick={() => setLibrary(true)}>Biblioteca FMH</button></div>
    <div className="engineeringDrawingShortcut"><button type="button" onClick={() => { setLibrary(false); setDrawings(false); }}>Asistente</button><button type="button" onClick={() => { setLibrary(true); setDrawings(false); }}>Biblioteca técnica</button><button type="button" className={drawings ? 'active' : ''} onClick={() => { setLibrary(false); setDrawings(true); }}>Planos FMH</button></div>
    {!library && !drawings ? <section className="engineeringWorkspace">
      <aside className="card engineeringConversations">
        <div className="sectionRow"><h2>Conversaciones</h2><button type="button" onClick={newConversation}>Nueva</button></div>
        <div className="conversationList">{conversations.map((item) => <button type="button" key={item.id} className={conversation?.id === item.id ? 'selected' : ''} onClick={() => openConversation(item.id)}><strong>{item.title || 'Nueva conversación'}</strong><small>{item.updatedAt ? new Date(item.updatedAt).toLocaleString('es-AR') : ''}</small></button>)}{!conversations.length && <p className="mutedText">Todavía no hay conversaciones.</p>}</div>
      </aside>
      <div className="card engineeringChat">
        <div className="sectionRow"><div><h2>{conversation?.title || 'Asistente de Ingeniería'}</h2><span className="mutedText">{conversation?.model || 'Modo local / modelo configurable'}</span></div>{conversation && <button type="button" onClick={saveCase}>Guardar como caso</button>}</div>
        <div className="engineeringMessages">{messages.map((item: AnyRecord) => <article className={`engineeringMessage ${item.role}`} key={item.id}><span>{item.role === 'user' ? 'Vos' : 'Asistente'}</span><p>{item.content}</p>{item.role === 'assistant' && item.structuredResultJson && <TechnicalDetails result={item.structuredResultJson} />}</article>)}{loading && <article className="engineeringMessage assistant"><span>Asistente</span><p>Analizando...</p></article>}{!messages.length && <Empty title="Iniciá un caso" text="Podés comenzar con un silo, galpón, tolva, estructura o cualquier consulta técnica." />}</div>
        <form className="engineeringComposer" onSubmit={ask}><textarea rows={3} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ej.: Necesito comparar 4 contra 6 patas para un silo aéreo de 200 t." /><div><button disabled={loading || !message.trim()}>Enviar</button><button type="button" onClick={downloadDrawing} disabled={!conversation}>Esquema SVG</button></div></form>
      </div>
    </section> : library ? <EngineeringLibrary companyId={companyId} /> : <EngineeringDrawings companyId={companyId} />}
  </Page>;
}

function DashboardOverview({ data, setView }: { data: AnyRecord; setView: (view: View) => void }) {
  const stats = data.dashboard?.stats || {};
  const recentDocuments = data.dashboard?.recentDocuments || [];
  return <Page eyebrow="Control operativo" title="Resumen del negocio" text="Actividad comercial, documentación y tareas que requieren seguimiento." action={<button className="primaryButton" onClick={() => setView('delivery-notes')}><ClipboardList size={16} /> Revisar remitos</button>}>
    <section className="dashboardMetrics">
      <article><span className="metricIconBox"><Users size={17} /></span><div><span className="metricLabel">Clientes activos</span><strong>{stats.customers || 0}</strong><small>registros comerciales</small></div></article>
      <article><span className="metricIconBox"><PackageSearch size={17} /></span><div><span className="metricLabel">Ítems de catálogo</span><strong>{stats.products || 0}</strong><small>materiales y trabajos</small></div></article>
      <article><span className="metricIconBox"><ReceiptText size={17} /></span><div><span className="metricLabel">Presupuestos</span><strong>{stats.quotes || 0}</strong><small>históricos y vigentes</small></div></article>
      <article className={stats.documentsPending ? 'attention' : ''}><span className="metricIconBox"><FileCheck2 size={17} /></span><div><span className="metricLabel">Pendientes de revisión</span><strong>{stats.documentsPending || 0}</strong><small>documentos por resolver</small></div></article>
    </section>
    <section className="quickActions"><div><span className="pageEyebrow">Acciones frecuentes</span><h2>Operación diaria</h2></div><div className="quickActionGrid"><button onClick={() => setView('quotes')}><Plus size={16} /><span><strong>Nuevo presupuesto</strong><small>Preparar propuesta</small></span><ArrowRight size={14} /></button><button onClick={() => setView('assistant')}><ClipboardList size={16} /><span><strong>Generar remito</strong><small>Desde una instrucción</small></span><ArrowRight size={14} /></button><button onClick={() => setView('documents')}><Upload size={16} /><span><strong>Incorporar documentos</strong><small>Ordenar históricos</small></span><ArrowRight size={14} /></button></div></section>
    <section className="dashboardGrid">
      <div className="card dashboardPanel"><div className="panelHeader"><div><span className="pageEyebrow">Actividad comercial</span><h2>Presupuestos recientes</h2></div><button className="textButton" onClick={() => setView('quotes')}>Ver todos <ArrowRight size={14} /></button></div><Table headers={['Número', 'Cliente', 'Estado', 'Total']} rows={(data.dashboard?.recentQuotes || []).map((q: AnyRecord) => <tr key={q.id}><td className="mono">#{q.number}</td><td><strong>{q.customer?.legalName || 'Cliente sin nombre'}</strong></td><td><Badge value={q.status} /></td><td className="amount">{money.format(Number(q.total || 0))}</td></tr>)} /></div>
      <div className="card dashboardPanel"><div className="panelHeader"><div><span className="pageEyebrow">Documentación</span><h2>Ingresos recientes</h2></div><button className="textButton" onClick={() => setView('documents')}>Abrir archivo <ArrowRight size={14} /></button></div><div className="activityList">{recentDocuments.slice(0, 5).map((d: AnyRecord) => <div className="activityItem" key={d.id}><span className="activityIcon"><FileText size={15} /></span><div><strong>{d.fileName || 'Documento sin nombre'}</strong><small>{labelFor(d.kind)}</small></div><Badge value={d.extractionStatus} /></div>)}{!recentDocuments.length && <Empty title="Sin documentos recientes" text="Los archivos incorporados aparecerán en este registro." />}</div></div>
    </section>
  </Page>;
}

function engineeringLabelFor(value: string) {
  const labels: Record<string, string> = { PRELIMINARY_DESIGN: 'Predimensionamiento preliminar', SUPPORTED_DETERMINISTIC: 'Cálculo realizado por el sistema', PRELIMINARY_ASSISTED: 'Análisis preliminar', CRITICAL: 'Necesario para continuar', IMPORTANT: 'Importante', OPTIONAL: 'Opcional', CURRENT: 'Versión comprobada', HISTORICAL: 'Precio histórico', NO_PRICE: 'Sin precio' };
  return labels[value] || value;
}

function LegacyTechnicalDetails({ result }: { result: AnyRecord | string }) {
  const parsed = typeof result === 'string' ? (() => { try { return JSON.parse(result); } catch { return { answer: result }; } })() : result;
  return <details className="technicalDetails"><summary>Ver análisis técnico</summary><div className="engineeringResult"><div className="resultBadges"><Badge value={labelFor(parsed.level || 'ORIENTATION')} /><Badge value={labelFor(parsed.capability || 'PRELIMINARY_ASSISTED')} /></div>{parsed.missingData?.length > 0 && <><h3>Datos que faltan</h3><ul>{parsed.missingData.map((item: AnyRecord) => <li key={item.name}><strong>{labelFor(item.name)}:</strong> {item.reason}</li>)}</ul></>}{parsed.assumptions?.length > 0 && <><h3>Hipótesis</h3><ul>{parsed.assumptions.map((item: string) => <li key={item}>{item}</li>)}</ul></>}{parsed.calculations?.length > 0 && <><h3>Cálculos realizados</h3>{parsed.calculations.map((item: AnyRecord) => <div className="trace" key={item.title}><strong>{item.title}</strong><span>{item.formula}</span><b>{Number(item.result).toFixed(2)} {item.resultUnit}</b></div>)}</>}{parsed.materials?.length > 0 && <><h3>Materiales preliminares</h3>{parsed.materials.map((item: AnyRecord) => <div className="trace" key={`${item.description}-${item.specification || ''}`}><strong>{item.description}</strong><span>{item.specification || 'Sección pendiente de confirmar'}</span><b>{item.totalLengthM ? `${Number(item.totalLengthM).toFixed(2)} m` : ''} {item.estimatedWeightKg ? `${Number(item.estimatedWeightKg).toFixed(1)} kg` : ''}</b></div>)}</>}{parsed.purchase?.length > 0 && <><h3>Resumen de compra</h3><ul>{parsed.purchase.map((item: AnyRecord) => <li key={item.description}>{item.description}: comprar {item.buyQuantity || 0} barras de {item.commercialLength || 12} m. {item.priceStatus === 'NO_PRICE' ? 'Precio pendiente.' : ''}</li>)}</ul></>}{parsed.sources?.length > 0 && <><h3>Antecedentes FMH</h3><ul>{parsed.sources.map((source: AnyRecord) => <li key={source.id}>{source.title}</li>)}</ul></>}{parsed.regulations?.length > 0 && <><h3>Normativa consultada</h3><ul>{parsed.regulations.map((item: AnyRecord) => <li key={item.code}>{item.code} — {labelFor(item.status)}</li>)}</ul></>}</div></details>;
}

function TechnicalDetails({ result }: { result: AnyRecord | string }) {
  const parsed = typeof result === 'string' ? (() => { try { return JSON.parse(result); } catch { return { answer: result }; } })() : result;
  return <details className="technicalDetails">
    <summary>Ver análisis técnico</summary>
    <div className="engineeringResult">
      <div className="resultBadges"><Badge value={labelFor(parsed.level || 'ORIENTATION')} /><Badge value={labelFor(parsed.capability || 'PRELIMINARY_ASSISTED')} /></div>
      {parsed.missingData?.length > 0 && <><h3>Datos que faltan</h3><ul>{parsed.missingData.map((item: AnyRecord) => <li key={item.name}><strong>{labelFor(item.name)}:</strong> {item.reason}</li>)}</ul></>}
      {parsed.assumptions?.length > 0 && <><h3>Hipótesis</h3><ul>{parsed.assumptions.map((item: string) => <li key={item}>{item}</li>)}</ul></>}
      {parsed.calculations?.length > 0 && <><h3>Cálculos realizados</h3>{parsed.calculations.map((item: AnyRecord) => <div className="trace" key={item.title}><strong>{item.title}</strong><span>{item.formula}</span><b>{Number(item.result).toFixed(2)} {item.resultUnit}</b></div>)}</>}
      {parsed.materials?.length > 0 && <><h3>Materiales preliminares</h3>{parsed.materials.map((item: AnyRecord) => <div className="trace" key={`${item.description}-${item.specification || ''}`}><strong>{item.description}</strong><span>{item.specification || 'Sección pendiente de confirmar'}</span><span>{item.sourceTitle ? `Origen: ${item.sourceTitle}` : 'Origen pendiente de verificar'}</span><b>{item.totalLengthM ? `${Number(item.totalLengthM).toFixed(2)} m` : ''} {item.estimatedWeightKg ? `${Number(item.estimatedWeightKg).toFixed(1)} kg` : 'Peso pendiente de kg/m'}</b></div>)}</>}
      {parsed.purchase?.length > 0 && <><h3>Resumen de compra</h3><ul>{parsed.purchase.map((item: AnyRecord) => <li key={item.description}>{item.description}: comprar {item.buyQuantity || 0} barras de {item.commercialLength || 12} m; stock disponible {Number(item.stockAvailable || 0).toFixed(2)} m. {item.priceStatus === 'NO_PRICE' ? 'Precio pendiente.' : `Subtotal: ${Number(item.subtotal || 0).toFixed(2)}`}</li>)}</ul></>}
      {parsed.estimatedCost?.total !== undefined && <><h3>Costo preliminar conocido</h3><p>{Number(parsed.estimatedCost.total).toFixed(2)} {parsed.estimatedCost.currency}.</p></>}
      {parsed.sources?.length > 0 && <><h3>Antecedentes FMH</h3><ul>{parsed.sources.map((source: AnyRecord) => <li key={source.id}>{source.title}</li>)}</ul></>}
      {parsed.regulations?.length > 0 && <><h3>Normativa consultada</h3><ul>{parsed.regulations.map((item: AnyRecord) => <li key={item.code}>{item.code} — {labelFor(item.status)}</li>)}</ul></>}
    </div>
  </details>;
}

function EngineeringLibrary({ companyId }: { companyId: string }) {
  const [knowledge, setKnowledge] = useState<AnyRecord>({ documents: [] });
  const [status, setStatus] = useState<AnyRecord | null>(null);
  const [busy, setBusy] = useState(false);
  async function load() {
    const [rows, current] = await Promise.all([api<AnyRecord>(`/api/engineering/knowledge?companyId=${companyId}&take=50`), api<AnyRecord>(`/api/engineering/ingestion/status?companyId=${companyId}`)]);
    setKnowledge(rows);
    setStatus(current);
  }
  useEffect(() => { load().catch(() => undefined); }, [companyId]);
  async function ingest() { setBusy(true); try { await postJson('/api/engineering/ingestion/start', { companyId }); await load(); } finally { setBusy(false); } }
  return <section className="card engineeringLibrary"><div className="sectionRow"><div><h2>Biblioteca técnica FMH</h2><span className="mutedText">Antecedentes internos y documentos procesados.</span></div><button type="button" onClick={ingest} disabled={busy}>{busy ? 'Actualizando...' : 'Actualizar biblioteca'}</button></div><div className="metrics compact"><article><span>Archivos</span><strong>{status?.totalFiles || 0}</strong></article><article><span>Procesados</span><strong>{status?.counts?.EXTRACTED || 0}</strong></article><article><span>Visión/revisión</span><strong>{(status?.counts?.NEEDS_VISION || 0) + (status?.counts?.NEEDS_REVIEW || 0)}</strong></article><article><span>Fallidos</span><strong>{status?.counts?.FAILED || 0}</strong></article></div><Table headers={['Archivo', 'Tipo', 'Estado']} rows={(knowledge.documents || []).map((doc: AnyRecord) => <tr key={doc.id}><td><strong>{doc.title}</strong><small>{doc.sourcePath}</small></td><td>{doc.documentType || doc.projectType || 'OTHER'}</td><td><Badge value={doc.verified ? 'VERIFIED_INTERNAL' : doc.status || 'HISTORICAL_PROJECT'} /></td></tr>)} /></section>;
}

function EngineeringDrawings({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<AnyRecord[]>([]);
  const [status, setStatus] = useState<AnyRecord | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    const [rows, current] = await Promise.all([api<AnyRecord[]>(`/api/engineering/drawings?companyId=${companyId}&q=${encodeURIComponent(query)}`), api<AnyRecord>(`/api/engineering/drawings/status?companyId=${companyId}`)]);
    setItems(rows); setStatus(current);
  }
  useEffect(() => { load().catch(() => undefined); }, [companyId]);
  async function ingest() { setBusy(true); try { await postJson('/api/engineering/drawings/ingestion/start', { companyId }); await load(); } finally { setBusy(false); } }
  return <section className="card engineeringDrawings"><div className="sectionRow"><div><h2>Biblioteca de Planos FMH</h2><span className="mutedText">Planos históricos, miniaturas y formato documental detectado localmente.</span></div><button type="button" onClick={ingest} disabled={busy}>{busy ? 'Analizando...' : 'Importar/actualizar planos'}</button></div><div className="toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar silo, tolva, galpón o cliente..." /><button type="button" onClick={() => load()}>Buscar</button></div><div className="metrics compact"><article><span>Planos</span><strong>{status?.total || 0}</strong></article><article><span>Analizados localmente</span><strong>{status?.counts?.ANALYZED_LOCAL || 0}</strong></article><article><span>Pendientes</span><strong>{status?.counts?.NEEDS_REVIEW || 0}</strong></article><article><span>Fallidos</span><strong>{status?.counts?.FAILED || 0}</strong></article></div><div className="drawingCards">{items.map((item) => <article className="drawingCard" key={item.id}><img src={`/api/engineering/drawings/${item.id}/thumbnail?companyId=${companyId}`} alt={item.fileName} /><div><strong>{item.drawingTitle || item.fileName}</strong><span>{item.projectType || 'Tipo pendiente'} {item.customerName ? `· ${item.customerName}` : ''}</span><small>{item.template?.name || 'Plantilla FMH escaneada'}</small><a href={`/api/engineering/drawings/${item.id}/file?companyId=${companyId}`} target="_blank" rel="noreferrer">Abrir PDF</a></div></article>)}{!items.length && <Empty title="Todavía no hay planos importados" text="Configurá ENGINEERING_DRAWINGS_ROOT o ejecutá la importación desde la carpeta local." />}</div></section>;
}

function EngineeringView({ companyId }: { companyId: string }) {
  const result: AnyRecord = {};
  const knowledge: AnyRecord = { documents: [] };
  const status: AnyRecord = {};
  const totalFiles = 0;
  const startIngestion = async () => undefined;
  const [message, setMessage] = useState('');
  const [conversations, setConversations] = useState<AnyRecord[]>([]);
  const [conversation, setConversation] = useState<AnyRecord | null>(null);
  const [library, setLibrary] = useState(false);
  const [loading, setLoading] = useState(false);

  async function loadConversations() {
    if (!companyId) return;
    setConversations(await api<AnyRecord[]>(`/api/engineering/conversations?companyId=${companyId}`));
  }
  useEffect(() => { loadConversations().catch(() => undefined); }, [companyId]);
  async function newConversation() {
    const created = await postJson<AnyRecord>('/api/engineering/conversations', { companyId });
    setConversations((current) => [created, ...current]); setConversation({ ...created, messages: [] });
  }
  async function openConversation(id: string) { setConversation(await api<AnyRecord>(`/api/engineering/conversations/${id}?companyId=${companyId}`)); }
  async function ask(event: React.FormEvent) {
    event.preventDefault(); if (!message.trim() || !companyId) return;
    const active = conversation || (await postJson<AnyRecord>('/api/engineering/conversations', { companyId }));
    if (!conversation) { setConversation({ ...active, messages: [] }); setConversations((current) => [active, ...current]); }
    setLoading(true);
    try { const response = await postJson<AnyRecord>(`/api/engineering/conversations/${active.id}/messages`, { companyId, message }); setConversation((current) => current ? { ...current, messages: [...(current.messages || []), response.userMessage, response.assistantMessage], state: response.state } : current); setMessage(''); await loadConversations(); } finally { setLoading(false); }
  }
  async function saveCase() { if (conversation) await postJson(`/api/engineering/conversations/${conversation.id}/save-case`, { companyId }); }
  return <Page title="Ingeniería FMH" text="Biblioteca técnica, cálculos preliminares y antecedentes trazables.">
    <section className="engineeringGrid">
      <div className="card engineeringChat">
        <h2>Asistente de Ingeniería</h2>
        <form className="form" onSubmit={ask}><label className="field"><span>Consulta técnica</span><textarea rows={5} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ej.: Necesito una tolva de 4 x 4 m, boca inferior 0,5 x 0,5 m y 3 m de alto." /></label><button disabled={loading}>{loading ? 'Calculando...' : 'Consultar'}</button></form>
        {result && <div className="engineeringResult"><h3>Respuesta</h3><p>{result.answer}</p>{result.missingData?.length > 0 && <><h3>Datos faltantes</h3><ul>{result.missingData.map((item: AnyRecord) => <li key={item.name}><strong>{item.name}:</strong> {item.reason}</li>)}</ul></>}{result.calculations?.length > 0 && <><h3>Cálculos</h3>{result.calculations.map((item: AnyRecord) => <div className="trace" key={item.title}><strong>{item.title}</strong><span>{item.formula}</span><b>{Number(item.result).toFixed(2)} {item.resultUnit}</b></div>)}</>}{result.sources?.length > 0 && <><h3>Fuentes FMH</h3><ul>{result.sources.map((source: AnyRecord) => <li key={source.id}>{source.title}</li>)}</ul></>}</div>}
      </div>
      <div className="card engineeringLibrary"><div className="sectionRow"><h2>Biblioteca técnica FMH</h2><button onClick={startIngestion}>Actualizar biblioteca</button></div><div className="metrics compact"><article><span>Archivos</span><strong>{totalFiles}</strong></article><article><span>Procesados</span><strong>{status?.counts?.EXTRACTED || 0}</strong></article><article><span>Visión/revisión</span><strong>{(status?.counts?.NEEDS_VISION || 0) + (status?.counts?.NEEDS_REVIEW || 0)}</strong></article><article><span>Fallidos</span><strong>{status?.counts?.FAILED || 0}</strong></article></div><Table headers={['Archivo', 'Tipo', 'Proyecto', 'Estado']} rows={(knowledge.documents || []).map((doc: AnyRecord) => <tr key={doc.id}><td><strong>{doc.title}</strong><small>{doc.sourcePath}</small></td><td>{doc.documentType}</td><td>{doc.type}</td><td><Badge value={doc.verified ? 'VERIFIED_INTERNAL' : 'HISTORICAL_PROJECT'} /></td></tr>)} /></div>
    </section>
  </Page>;
}

function Documents({ data, companyId, notify }: { data: AnyRecord; companyId: string; notify: Function }) {
  const [limit, setLimit] = useState(120);
  const [filters, setFilters] = useState({ q: '' });
  const [documents, setDocuments] = useState<AnyRecord[]>(data.documents || []);
  const [tree, setTree] = useState<AnyRecord | null>(null);
  const [selectedPath, setSelectedPath] = useState<{ kind?: string; year?: string; month?: number }>({});
  const [preview, setPreview] = useState<{ document: AnyRecord; data: AnyRecord } | null>(null);

  async function loadDocuments(next = filters) {
    if (!companyId) return;
    const qs = queryString({
      companyId,
      take: 500,
      q: next.q,
      kind: selectedPath.kind,
      year: selectedPath.year,
      month: selectedPath.month
    });
    const [rows, treeData] = await Promise.all([
      api<AnyRecord[]>(`/api/documents?${qs}`),
      api<AnyRecord>(`/api/documents/tree?${queryString({ companyId, q: next.q, take: 1800 })}`)
    ]);
    setDocuments(rows);
    setTree(treeData);
  }

  useEffect(() => {
    setDocuments(data.documents || []);
  }, [data.documents]);

  useEffect(() => {
    if (companyId) loadDocuments().catch(() => undefined);
  }, [companyId, selectedPath.kind, selectedPath.year, selectedPath.month]);

  useEffect(() => {
    if (!preview) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreview(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [preview]);

  function selectFolder(path: { kind?: string; year?: string; month?: number }) {
    setSelectedPath(path);
    setFilters((current) => ({ ...current, kind: path.kind || '' }));
  }

  async function openPreview(document: AnyRecord) {
    const data = await api<AnyRecord>(`/api/documents/${document.id}/preview?companyId=${encodeURIComponent(companyId)}`);
    setPreview({ document, data });
  }

  const currentSection = (tree?.sections || []).find((section: AnyRecord) => section.kind === selectedPath.kind);
  const currentYear = currentSection?.years?.find((year: AnyRecord) => year.year === selectedPath.year);
  const currentMonth = currentYear?.months?.find((month: AnyRecord) => month.month === selectedPath.month);
  const browserItems =
    !selectedPath.kind
      ? (tree?.sections || []).map((section: AnyRecord) => ({
          key: section.kind,
          label: section.label,
          count: section.count,
          folder: true,
          onClick: () => selectFolder({ kind: section.kind })
        }))
      : !selectedPath.year
        ? (currentSection?.years || []).map((year: AnyRecord) => ({
            key: `${selectedPath.kind}-${year.year}`,
            label: year.year,
            count: year.count,
            folder: true,
            onClick: () => selectFolder({ kind: selectedPath.kind, year: year.year })
          }))
        : !selectedPath.month
          ? (currentYear?.months || []).map((month: AnyRecord) => ({
              key: `${selectedPath.kind}-${selectedPath.year}-${month.month}`,
              label: month.label,
              count: month.count,
              folder: true,
              onClick: () => selectFolder({ kind: selectedPath.kind, year: selectedPath.year, month: month.month })
            }))
          : [];

  const currentTitle =
    !selectedPath.kind
      ? 'Carpetas'
      : !selectedPath.year
        ? documentKinds.find(([kind]) => kind === selectedPath.kind)?.[1] || selectedPath.kind
        : !selectedPath.month
          ? selectedPath.year
          : `${currentMonth?.label || ''} ${selectedPath.year || ''}`.trim();

  function goBack() {
    if (selectedPath.month) return selectFolder({ kind: selectedPath.kind, year: selectedPath.year });
    if (selectedPath.year) return selectFolder({ kind: selectedPath.kind });
    if (selectedPath.kind) return selectFolder({});
  }

  const visibleDocuments = selectedPath.month ? documents : [];
  const rows = visibleDocuments.map((d: AnyRecord) => (
    <tr key={d.id}>
      <td><strong>{d.displayName || d.fileName}</strong><small>{d.displayCustomer || d.issuerName || d.extraction?.engine || d.mimeType}</small></td>
      <td><Badge value={d.kind} /></td>
      <td><Badge value={d.extractionStatus} /></td>
      <td>{d.documentDate || d.inferredDate ? dateFmt.format(new Date(d.documentDate || d.inferredDate)) : d.createdAt ? dateFmt.format(new Date(d.createdAt)) : ''}</td>
      <td>{d.total ? money.format(Number(d.total)) : '-'}</td>
      <td className="actions">
        <button type="button" onClick={() => openPreview(d)}>Ver</button>
        <button onClick={() => notify('Documento extraído.', () => postJson(`/api/documents/${d.id}/extract`, { companyId })).then(() => loadDocuments())}>Extraer</button>
        <button onClick={() => notify('Borrador creado.', () => postJson(`/api/documents/${d.id}/create-quote-draft`, { companyId })).then(() => loadDocuments())}>Presupuesto</button>
      </td>
    </tr>
  ));

  return (
    <Page title="Documentos" text="Biblioteca por tipo, año y mes. Buscá por nombre y entrá a las carpetas para ver archivos." action={<button onClick={() => notify('Importación histórica finalizada.', () => postJson('/api/documents/import-historical', { companyId, limit })).then(() => loadDocuments())}><Upload size={16} /> Importar</button>}>
      <div className="toolbar wide"><Field label="Límite de importación" type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></div>
      <section className="card filters">
        <Field label="Buscar por nombre" value={filters.q} onChange={(e) => setFilters({ q: e.target.value })} placeholder="Nombre de archivo o cliente..." />
        <button onClick={() => { setSelectedPath({}); loadDocuments({ ...filters }); }}>Buscar</button>
      </section>
      <section className="documentLayout">
        <div className="card fileTree">
          <div className="sectionRow"><h2>Ficheros</h2>{(selectedPath.kind || selectedPath.year || selectedPath.month) ? <button type="button" onClick={goBack}>Volver</button> : <button type="button" onClick={() => selectFolder({})}>Raíz</button>}</div>
          <div className="breadcrumbs">
            <button type="button" onClick={() => selectFolder({})}>Raíz</button>
            {selectedPath.kind && <button type="button" onClick={() => selectFolder({ kind: selectedPath.kind })}>{documentKinds.find(([kind]) => kind === selectedPath.kind)?.[1] || selectedPath.kind}</button>}
            {selectedPath.year && <button type="button" onClick={() => selectFolder({ kind: selectedPath.kind, year: selectedPath.year })}>{selectedPath.year}</button>}
            {selectedPath.month && <span>{currentMonth?.label}</span>}
          </div>
          <div className="treeSection">
            {browserItems.map((item: AnyRecord) => (
              <button type="button" key={item.key} className="treeBrowserItem" onClick={item.onClick}>
                {item.folder ? <FolderOpen size={16} /> : <FileText size={16} />}
                <span>{item.label}</span>
                <small>{item.count}</small>
              </button>
            ))}
            {!browserItems.length && <Empty title="Sin subcarpetas" text="Entrá a una carpeta para ver sus archivos." />}
          </div>
        </div>
        <div className="card">
          <div className="sectionRow"><h2>{currentTitle}</h2><span className="mutedText">{visibleDocuments.length} archivos</span></div>
          <Table headers={['Archivo', 'Tipo', 'Extracción', 'Fecha', 'Total', 'Acciones']} rows={rows} />
        </div>
      </section>
      {preview && (
        <div className="previewOverlay" role="dialog" aria-modal="true" aria-labelledby="document-preview-title">
          <div className="previewPanel">
            <div className="previewHead">
              <div><strong id="document-preview-title">{preview.document.displayName || preview.document.fileName}</strong><span>{preview.document.displayCustomer || preview.document.issuerName || preview.document.kind}</span></div>
              <button type="button" autoFocus onClick={() => setPreview(null)}>Cerrar</button>
            </div>
            {preview.data.type === 'pdf' && <iframe title={preview.document.fileName} src={preview.data.url} />}
            {preview.data.type === 'image' && <img src={preview.data.url} alt={preview.document.fileName} />}
            {preview.data.type === 'html' && <article className="docHtml" dangerouslySetInnerHTML={{ __html: preview.data.html }} />}
            {preview.data.type === 'unsupported' && <Empty title="Vista no disponible" text={preview.data.message || 'Este formato todavia no tiene vista previa.'} />}
          </div>
        </div>
      )}
    </Page>
  );
}

type QuoteDraftLine = {
  productId: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  taxRate: number;
};

function DeliveryNotes({ data, companyId, notify }: { data: AnyRecord; companyId: string; notify: Function }) {
  const notes = (data.deliveryNotes || []) as AnyRecord[];
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<AnyRecord | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('PENDING');
  const monthKey = (value: string | Date) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  };
  const availableMonths = useMemo(
    () => [...new Set(notes.map((note) => monthKey(note.issueDate)))].sort().reverse(),
    [notes]
  );
  const [billingMonth, setBillingMonth] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  });
  useEffect(() => {
    if (availableMonths.length && !availableMonths.includes(billingMonth)) setBillingMonth(availableMonths[0]!);
  }, [availableMonths, billingMonth]);
  const visibleNotes = notes.filter(
    (note) => monthKey(note.issueDate) === billingMonth && (status === 'ALL' || note.status === status)
  );
  const selectedNotes = notes.filter((note) => selected.includes(note.id));
  const customerId = selectedNotes[0]?.customerId;
  const sameCustomer = selectedNotes.every((note) => note.customerId === customerId);
  const selectedCustomer = selectedNotes[0]?.customer?.legalName;
  const pendingCount = notes.filter((note) => monthKey(note.issueDate) === billingMonth && note.status === 'PENDING').length;
  const pendingCustomers = new Set(
    notes.filter((note) => monthKey(note.issueDate) === billingMonth && note.status === 'PENDING').map((note) => note.customerId)
  ).size;
  const previewLines = (preview?.lines || []) as AnyRecord[];
  const closeTotals = useMemo(() => {
    return previewLines.reduce((total, line) => {
      const unitPrice = Number(prices[line.itemId] || 0);
      const net = Number(line.quantity || 0) * unitPrice;
      const tax = net * (Number(line.taxRate || 0) / 100);
      return { subtotal: total.subtotal + net, tax: total.tax + tax, total: total.total + net + tax };
    }, { subtotal: 0, tax: 0, total: 0 });
  }, [previewLines, prices]);
  const allPricesReady = previewLines.length > 0 && previewLines.every((line: AnyRecord) => {
    const value = Number(prices[line.itemId]);
    return Number.isFinite(value) && value > 0;
  });

  function resetSelection() {
    setSelected([]);
    setPreview(null);
    setPrices({});
  }

  function changeMonth(value: string) {
    setBillingMonth(value);
    resetSelection();
  }

  function selectCustomerPending(customerIdToSelect: string) {
    setSelected(
      visibleNotes
        .filter((note) => note.customerId === customerIdToSelect && note.status === 'PENDING')
        .map((note) => note.id)
    );
    setPreview(null);
    setPrices({});
  }

  async function prepareQuote() {
    if (!customerId || !sameCustomer) return;
    const result = await postJson<AnyRecord>('/api/delivery-notes/convert-to-quote/preview', {
      companyId,
      customerId,
      deliveryNoteIds: selected,
      billingMonth
    });
    setPreview(result);
    setPrices(Object.fromEntries((result.lines || []).map((line: AnyRecord) => [
      line.itemId,
      line.unitPrice == null || Number(line.unitPrice) <= 0 ? '' : String(line.unitPrice)
    ])));
  }
  async function saveQuote() {
    if (!preview || !customerId || !allPricesReady) return;
    await notify('Presupuesto creado desde remitos.', () => postJson('/api/delivery-notes/convert-to-quote', {
      companyId,
      customerId,
      deliveryNoteIds: selected,
      billingMonth,
      prices: Object.fromEntries(Object.entries(prices).map(([id, value]) => [id, Number(value)]))
    }));
    resetSelection();
  }
  async function closeMonth(invoiceType: 'A' | 'B') {
    if (!preview || !customerId || !allPricesReady) return;
    const confirmed = window.confirm(
      `Vas a crear un borrador de factura ${invoiceType} por ${money.format(closeTotals.total)} para ${selectedCustomer}. ` +
      'Los remitos seleccionados quedarán marcados como facturados. ¿Continuar?'
    );
    if (!confirmed) return;
    await notify('Cierre mensual preparado como borrador de factura.', () => postJson('/api/delivery-notes/close-month', {
      companyId,
      customerId,
      deliveryNoteIds: selected,
      billingMonth,
      invoiceType,
      prices: Object.fromEntries(Object.entries(prices).map(([id, value]) => [id, Number(value)]))
    }));
    resetSelection();
  }

  const customerGroups = [...new Map(
    visibleNotes.map((note) => [note.customerId, note.customer?.legalName || 'Cliente sin nombre'])
  ).entries()];

  return (
    <Page title="Remitos" text="Orden mensual de trabajos, consolidación por cliente y preparación de facturas.">
      <section className="deliveryMonthToolbar card">
        <label className="field compactField">
          <span>Mes de trabajo</span>
          <select value={billingMonth} onChange={(event) => changeMonth(event.target.value)}>
            {(availableMonths.length ? availableMonths : [billingMonth]).map((month) => (
              <option key={month} value={month}>
                {new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(new Date(`${month}-15T12:00:00`))}
              </option>
            ))}
          </select>
        </label>
        <label className="field compactField">
          <span>Estado</span>
          <select value={status} onChange={(event) => { setStatus(event.target.value); resetSelection(); }}>
            <option value="PENDING">Pendientes</option>
            <option value="INVOICED">Facturados</option>
            <option value="QUOTED">Presupuestados</option>
            <option value="ALL">Todos</option>
          </select>
        </label>
        <div className="monthMetric"><span>Pendientes</span><strong>{pendingCount}</strong></div>
        <div className="monthMetric"><span>Clientes para cerrar</span><strong>{pendingCustomers}</strong></div>
      </section>

      <section className="card">
        <div className="sectionHead">
          <div>
            <h2>Remitos del mes</h2>
            <p className="muted">Elegí un cliente y consolidá todos o algunos de sus remitos. Nunca se mezclan clientes ni meses.</p>
          </div>
          <button className="primaryButton" disabled={!selected.length || !sameCustomer} onClick={prepareQuote}>
            Revisar cierre ({selected.length})
          </button>
        </div>
        {status === 'PENDING' && customerGroups.length > 0 && (
          <div className="customerCloseChips">
            {customerGroups.map(([groupCustomerId, name]) => {
              const count = visibleNotes.filter((note) => note.customerId === groupCustomerId && note.status === 'PENDING').length;
              return count ? <button type="button" key={groupCustomerId} onClick={() => selectCustomerPending(groupCustomerId)}>{name} <span>{count}</span></button> : null;
            })}
          </div>
        )}
        <Table headers={['', 'Número', 'Cliente', 'Fecha', 'Descripción', 'Estado', 'PDF']} rows={visibleNotes.map((note) => <tr key={note.id}>
          <td><input type="checkbox" aria-label={`Seleccionar remito ${note.number}`} checked={selected.includes(note.id)} disabled={note.status !== 'PENDING' || (selected.length > 0 && note.customerId !== customerId)} onChange={(event) => {
            setPreview(null);
            setPrices({});
            setSelected((current) => event.target.checked ? [...current, note.id] : current.filter((id) => id !== note.id));
          }} /></td>
          <td>#{String(note.number).padStart(5, '0')}</td>
          <td><strong>{note.customer?.legalName}</strong></td>
          <td>{dateFmt.format(new Date(note.issueDate))}</td>
          <td>{note.items?.map((item: AnyRecord) => item.description).join('; ')}</td>
          <td><Badge value={note.status} /></td>
          <td>{note.documentId && <a href={`/api/documents/${note.documentId}/content?companyId=${encodeURIComponent(companyId)}`} target="_blank" rel="noreferrer">Ver PDF</a>}</td>
        </tr>)} />
      </section>

      {preview && <section className="card monthlyCloseReview">
        <div className="sectionHead">
          <div><span className="pageEyebrow">Cierre mensual</span><h2>{selectedCustomer}</h2><p className="muted">{preview.deliveryNotes?.length || selected.length} remito(s). Completá los precios antes de continuar.</p></div>
          <button type="button" onClick={resetSelection}>Cancelar selección</button>
        </div>
        <Table headers={['Origen', 'Descripción', 'Cantidad', 'Precio unitario']} rows={(preview.lines || []).map((line: AnyRecord) => <tr key={line.itemId}>
          <td>#{String(line.deliveryNoteNumber).padStart(5, '0')}</td>
          <td>{line.description}</td>
          <td>{line.quantity} {line.unit}</td>
          <td><label className="priceInput"><span>$</span><input type="number" min="0.01" step="0.01" value={prices[line.itemId] ?? ''} onChange={(event) => setPrices((current) => ({ ...current, [line.itemId]: event.target.value }))} aria-label={`Precio de ${line.description}`} /></label></td>
        </tr>)} />
        {!allPricesReady && <p className="formWarning">Completá todos los precios con importes mayores a cero.</p>}
        <div className="quoteTotals" aria-live="polite">
          <span>Moneda: {preview.currency || 'ARS'}</span>
          <span>Subtotal: {money.format(closeTotals.subtotal)}</span>
          <span>IVA: {money.format(closeTotals.tax)}</span>
          <strong>Total del cierre: {money.format(closeTotals.total)}</strong>
        </div>
        <div className="monthlyCloseActions">
          <button type="button" disabled={!allPricesReady} onClick={saveQuote}>Sólo presupuesto</button>
          <button type="button" className="primaryButton" disabled={!allPricesReady} onClick={() => closeMonth('B')}>Preparar factura B</button>
          <button type="button" className="primaryButton" disabled={!allPricesReady} onClick={() => closeMonth('A')}>Preparar factura A</button>
        </div>
        <p className="muted">Se crea un borrador revisable. La autorización fiscal ante ARCA sigue siendo un paso separado.</p>
      </section>}
    </Page>
  );
}

function Quotes({ data, companyId, notify }: { data: AnyRecord; companyId: string; notify: Function }) {
  const customers = data.customers || [];
  const products = data.products || [];
  const [lines, setLines] = useState<QuoteDraftLine[]>([
    { productId: '', description: '', quantity: 1, unit: 'unidad', unitPrice: 0, taxRate: 21 }
  ]);
  const [marginPercent, setMarginPercent] = useState(0);
  const [expandedLine, setExpandedLine] = useState(0);
  const [saving, setSaving] = useState(false);
  const [quoteError, setQuoteError] = useState('');

  const preview = useMemo(() => {
    const priced = lines.map((line) => ({
      ...line,
      unitPrice: Math.round((Number(line.unitPrice || 0) * (1 + marginPercent / 100) + Number.EPSILON) * 100) / 100
    }));
    const subtotal = priced.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    const tax = priced.reduce((sum, line) => sum + line.quantity * line.unitPrice * (line.taxRate / 100), 0);
    return { subtotal, tax, total: subtotal + tax, priced };
  }, [lines, marginPercent]);

  function updateLine(index: number, patch: Partial<QuoteDraftLine>) {
    setLines((current) => current.map((line, itemIndex) => (itemIndex === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => [...current, { productId: '', description: '', quantity: 1, unit: 'trabajo', unitPrice: 0, taxRate: 21 }]);
    setExpandedLine(lines.length);
  }

  function removeLine(index: number) {
    setLines((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setExpandedLine((current) => {
      if (current === index) return Math.max(0, index - 1);
      return current > index ? current - 1 : current;
    });
  }

  function lineSummary(line: QuoteDraftLine, index: number) {
    const linkedName = products.find((item: AnyRecord) => item.id === line.productId)?.name;
    const title = line.description.trim() || linkedName || ('Item ' + (index + 1));
    return {
      title,
      total: Number(line.quantity || 0) * Number(line.unitPrice || 0)
    };
  }

  function selectProduct(index: number, productId: string) {
    const product = products.find((item: AnyRecord) => item.id === productId);
    if (!product) return updateLine(index, { productId });
    updateLine(index, {
      productId,
      description: product.name,
      unit: product.unit || 'unidad',
      unitPrice: Number(product.price || product.baseCost || product.lastCost || 0),
      taxRate: Number(product.taxRate || 21)
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuoteError('');
    const form = new FormData(event.currentTarget);
    const customerId = String(form.get('customerId') || '');
    if (!customerId) {
      setQuoteError('Seleccioná un cliente.');
      return;
    }
    if (!lines.length || lines.some((line) => !line.description.trim() || Number(line.quantity) <= 0 || Number(line.unitPrice) <= 0)) {
      setQuoteError('Cada ítem debe tener descripción, cantidad y precio mayores a cero.');
      return;
    }
    setSaving(true);
    try {
      await notify('Presupuesto creado.', () => postJson('/api/quotes/draft-from-items', {
        companyId,
        customerId,
        marginPercent,
        notes: String(form.get('notes') || ''),
        items: lines.map((line) => ({
          productId: line.productId || undefined,
          description: line.description.trim(),
          quantity: Number(line.quantity),
          unit: line.unit,
          unitPrice: Number(line.unitPrice),
          taxRate: Number(line.taxRate)
        }))
      }));
    } catch (caught) {
      setQuoteError(caught instanceof Error ? caught.message : 'No se pudo crear el presupuesto.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page title="Presupuestos" text="Crear y descargar presupuestos.">
      <section className="grid two">
        <form className="card form quoteBuilder" onSubmit={submit}>
          <div className="sectionRow"><h2>Nuevo borrador FMH</h2><button type="button" onClick={addLine}>Agregar item</button></div>
          <SelectField label="Cliente" name="customerId" required defaultValue=""><option value="" disabled>Seleccionar cliente</option>{customers.map((c: AnyRecord) => <option value={c.id} key={c.id}>{c.legalName}</option>)}</SelectField>
          {lines.map((line, index) => {
            const summary = lineSummary(line, index);
            return (
              <div className={`lineEditor ${expandedLine === index ? 'expanded' : 'collapsed'}`} key={index}>
                <button type="button" className="lineToggle" onClick={() => setExpandedLine((current) => current === index ? -1 : index)}>
                  <span className="lineToggleTitle">
                    {expandedLine === index ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <strong>Item {index + 1}</strong>
                    <em>{summary.title}</em>
                  </span>
                  <small>{money.format(summary.total)}</small>
                </button>
                {expandedLine === index && (
                  <>
                    <div className="lineHead"><strong>Datos del item</strong>{lines.length > 1 && <button type="button" onClick={() => removeLine(index)}>Quitar</button>}</div>
                    <SelectField label="Producto o trabajo" value={line.productId} onChange={(event) => selectProduct(index, event.target.value)}>
                      <option value="">Manual / sin vincular</option>
                      {products.map((p: AnyRecord) => <option value={p.id} key={p.id}>{p.name} {p.category ? `(${p.category})` : ''}</option>)}
                    </SelectField>
                    <label className="field full"><span>Descripcion</span><textarea value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} rows={3} required /></label>
                    <div className="lineGrid">
                      <Field label="Cantidad" type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} required />
                      <Field label="Unidad" value={line.unit} onChange={(event) => updateLine(index, { unit: event.target.value })} />
                      <Field label="Precio" type="number" min="0.01" step="0.01" value={line.unitPrice} onChange={(event) => updateLine(index, { unitPrice: Number(event.target.value) })} required />
                      <Field label="IVA %" type="number" min="0" max="100" step="0.01" value={line.taxRate} onChange={(event) => updateLine(index, { taxRate: Number(event.target.value) })} />
                    </div>
                  </>
                )}
              </div>
            );
          })}
          <Field label="Margen general %" type="number" min="-100" max="1000" step="0.01" value={marginPercent} onChange={(event) => setMarginPercent(Number(event.target.value))} />
          <Field label="Notas" name="notes" />
          {quoteError && <p className="formWarning" role="alert">{quoteError}</p>}
          <div className="quoteTotals">
            <span>Subtotal: {money.format(preview.subtotal)}</span>
            <span>IVA: {money.format(preview.tax)}</span>
            <strong>Total: {money.format(preview.total)}</strong>
          </div>
          <button disabled={saving || !customers.length}>{saving ? 'Creando…' : 'Crear borrador'}</button>
        </form>
        <div className="card"><h2>Listado</h2><Table headers={['N°', 'Cliente', 'Estado', 'Total', 'Descargas']} rows={(data.quotes || []).map((q: AnyRecord) => <tr key={q.id}><td>#{q.number}</td><td>{q.customer.legalName}</td><td><Badge value={q.status} /></td><td>{money.format(Number(q.total))}</td><td className="actions"><a href={`/api/quotes/${q.id}/docx?companyId=${encodeURIComponent(companyId)}`} target="_blank"><FileText size={16} /> DOCX</a><a href={`/api/quotes/${q.id}/pdf?companyId=${encodeURIComponent(companyId)}`} target="_blank"><FileText size={16} /> PDF</a></td></tr>)} /></div>
      </section>
    </Page>
  );
}

function Invoices({ data, companyId, notify }: { data: AnyRecord; companyId: string; notify: Function }) {
  const invoices = data.invoices || [];
  const quotes = data.quotes || [];
  const [quoteQuery, setQuoteQuery] = useState('');
  const [arcaError, setArcaError] = useState('');
  const visibleQuotes = quotes.filter((quote: AnyRecord) => {
    const haystack = `${quote.number} ${quote.customer?.legalName || ''}`.toLocaleLowerCase('es-AR');
    return haystack.includes(quoteQuery.trim().toLocaleLowerCase('es-AR'));
  });

  async function createDraft(quoteId: string, type: 'A' | 'B') {
    await notify('Borrador de factura creado.', () => postJson('/api/quotes/' + quoteId + '/invoice-draft', { type, companyId }));
  }

  async function authorize(invoiceId: string) {
    setArcaError('');
    try {
      const preflight = await api<AnyRecord>('/api/invoices/' + invoiceId + '/arca-preflight?companyId=' + encodeURIComponent(companyId));
      if (!preflight.ok) {
        throw new Error(`No se puede autorizar: ${(preflight.missing || []).join(', ') || 'faltan datos obligatorios'}.`);
      }
      const confirmed = window.confirm(
        `Se enviará la factura a ARCA en ${preflight.environment}. Esta acción fiscal no se puede deshacer. ¿Continuar?`
      );
      if (!confirmed) return;
      await notify('Factura enviada a ARCA.', () => postJson('/api/invoices/' + invoiceId + '/authorize-arca', { companyId }));
    } catch (caught) {
      setArcaError(caught instanceof Error ? caught.message : 'No se pudo validar la factura para ARCA.');
    }
  }

  return (
    <Page title="Facturas" text="Prepará comprobantes A o B y revisalos antes de enviarlos a ARCA.">
      <section className="card invoiceCreate">
        <div className="sectionRow"><div><h2>Crear desde presupuesto</h2><p className="mutedText">Elegí un presupuesto y el tipo de comprobante.</p></div></div>
        <Field label="Buscar presupuesto o cliente" value={quoteQuery} onChange={(event) => setQuoteQuery(event.target.value)} placeholder="Ej. 125 o Metalúrgica..." />
        <div className="invoiceCreateGrid">
          {visibleQuotes.map((quote: AnyRecord) => (
            <div className="invoiceQuoteCard" key={quote.id}>
              <strong>Presupuesto #{quote.number}</strong>
              <span>{quote.customer?.legalName || 'Cliente sin nombre'}</span>
              <b>{money.format(Number(quote.total || 0))}</b>
              <div className="actions"><button type="button" onClick={() => createDraft(quote.id, 'A')}>Factura A</button><button type="button" onClick={() => createDraft(quote.id, 'B')}>Factura B</button></div>
            </div>
          ))}
          {!visibleQuotes.length && <Empty title="Sin presupuestos coincidentes" text={quotes.length ? 'Probá otra búsqueda.' : 'Creá un presupuesto para preparar una factura.'} />}
        </div>
      </section>
      {arcaError && <p className="formWarning" role="alert">{arcaError}</p>}
      <section className="card"><div className="sectionRow"><h2>Comprobantes</h2><span className="mutedText">{invoices.length} registrados</span></div>
        <Table headers={['Tipo', 'Cliente', 'Estado', 'Total', 'CAE', 'Acciones']} rows={invoices.map((invoice: AnyRecord) => <tr key={invoice.id}><td><Badge value={invoice.type} /></td><td>{invoice.customer?.legalName || '-'}</td><td><Badge value={invoice.status} /></td><td>{money.format(Number(invoice.total || 0))}</td><td>{invoice.cae || 'Pendiente'}</td><td className="actions">{invoice.status === 'PENDING_CONFIRMATION' && <button type="button" onClick={() => authorize(invoice.id)}>Autorizar ARCA</button>}</td></tr>)} />
      </section>
    </Page>
  );
}

function Inventory({ data, companyId, notify }: { data: AnyRecord; companyId: string; notify: Function }) {
  const [filters, setFilters] = useState({ q: '', category: '', type: 'MATERIAL', priceStatus: 'all', supplierStatus: 'all', active: 'true', sort: 'name' });
  const [products, setProducts] = useState<AnyRecord[]>((data.products || []).filter((product: AnyRecord) => product.type === 'MATERIAL'));
  const [publicSources, setPublicSources] = useState<AnyRecord[]>([]);
  const [materialReferences, setMaterialReferences] = useState<AnyRecord[]>([]);

  useEffect(() => {
    setProducts((data.products || []).filter((product: AnyRecord) => product.type === 'MATERIAL'));
  }, [data.products]);

  useEffect(() => {
    api<AnyRecord[]>('/api/supplier-public-sources').then(setPublicSources).catch(() => setPublicSources([]));
  }, []);

  useEffect(() => {
    if (!companyId) return;
    api<AnyRecord[]>(`/api/material-price-references?companyId=${companyId}&take=12`).then(setMaterialReferences).catch(() => setMaterialReferences([]));
  }, [companyId, data.products]);

  async function loadProducts(next = filters) {
    if (!companyId) return;
    const qs = queryString({ companyId, take: 500, ...next, active: next.active === '' ? undefined : next.active });
    setProducts(await api<AnyRecord[]>(`/api/products?${qs}`));
    setMaterialReferences(await api<AnyRecord[]>(`/api/material-price-references?companyId=${companyId}&take=12`));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await notify('Material guardado.', () => postJson('/api/products', { companyId, type: 'MATERIAL', name: form.get('name'), category: form.get('category') || 'Material', unit: form.get('unit'), price: Number(form.get('price') || 0) })).then(() => loadProducts());
  }

  async function syncPublicPrices() {
    await notify('Precios públicos sincronizados.', () => postJson('/api/supplier-public-sync', { companyId })).then(() => loadProducts());
  }

  const missingPrice = products.filter((p) => Number(p.price || 0) === 0).length;
  const missingSupplier = products.filter((p) => !p.supplierPrices?.length).length;

  return (
    <Page title="Inventario" text="Materiales presupuestables, precios de proveedores y listas de trabajo para completar datos." action={<button type="button" onClick={syncPublicPrices}>Actualizar precios públicos</button>}>
      <section className="metrics compact">
        <article><span>Productos filtrados</span><strong>{products.length}</strong></article>
        <article><span>Sin precio</span><strong>{missingPrice}</strong></article>
        <article><span>Sin proveedor</span><strong>{missingSupplier}</strong></article>
        <article><span>Sugerencias</span><strong>{data.inventory?.suggestions?.length || 0}</strong></article>
      </section>
      <section className="card filters">
        <Field label="Buscar material" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="chapa galvanizada, caño, perfil UPN..." />
        <Field label="Categoría" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} />
        <SelectField label="Tipo" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}><option value="MATERIAL">Materiales</option><option value="PRODUCT">Componentes/equipos</option><option value="SERVICE">Trabajos</option><option value="all">Todo</option></SelectField>
        <SelectField label="Precio" value={filters.priceStatus} onChange={(e) => setFilters({ ...filters, priceStatus: e.target.value })}><option value="all">Todos</option><option value="missing">Sin precio</option><option value="priced">Con precio</option></SelectField>
        <SelectField label="Proveedor" value={filters.supplierStatus} onChange={(e) => setFilters({ ...filters, supplierStatus: e.target.value })}><option value="all">Todos</option><option value="missing">Sin proveedor</option><option value="linked">Con proveedor</option></SelectField>
        <SelectField label="Estado" value={filters.active} onChange={(e) => setFilters({ ...filters, active: e.target.value })}><option value="">Todos</option><option value="true">Activos</option><option value="false">Inactivos</option></SelectField>
        <SelectField label="Orden" value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}><option value="name">Nombre</option><option value="priceAsc">Precio menor</option><option value="priceDesc">Precio mayor</option><option value="createdDesc">Últimos creados</option></SelectField>
        <button onClick={() => loadProducts()}>Aplicar filtros</button>
      </section>
      <section className="grid two">
        <form className="card form" onSubmit={submit}><h2>Nuevo material</h2><Field label="Nombre técnico" name="name" required /><Field label="Categoría" name="category" defaultValue="Material" /><Field label="Unidad" name="unit" defaultValue="unidad" /><Field label="Precio venta" name="price" type="number" defaultValue="0" /><button>Guardar</button></form>
        <div className="card">
          <h2>Fuentes públicas</h2>
          <div className="sourceGrid">
            {publicSources.map((source) => <a href={source.website} target="_blank" key={source.name}><strong>{source.name}</strong><span>{labelFor(source.method)}</span></a>)}
          </div>
        </div>
      </section>
      <section className="card">
        <h2>Materiales con referencia</h2>
        <Table
          headers={['Material', 'Precio', 'Mejor referencia', 'Alternativas']}
          rows={materialReferences.map((item: AnyRecord) => (
            <tr key={item.product.id}>
              <td><strong>{item.product.name}</strong><small>{item.product.category || item.product.unit || '-'}</small></td>
              <td>{money.format(Number(item.product.price || item.product.baseCost || 0))}</td>
              <td>{item.best ? `${item.best.supplier.name}: ${money.format(Number(item.best.price))}` : 'Sin referencia'}</td>
              <td>{(item.alternatives || []).slice(0, 3).map((alt: AnyRecord) => `${alt.supplier.name}: ${money.format(Number(alt.price))}`).join(' | ') || '-'}</td>
            </tr>
          ))}
        />
      </section>
      <section className="card"><h2>Materiales</h2><Table headers={['Nombre', 'Categoría', 'Tipo', 'Venta', 'Estado', 'Mejores precios']} rows={products.map((p: AnyRecord) => <tr key={p.id}><td><strong>{p.name}</strong><small>{p.normalizedName || p.unit}</small></td><td>{p.category || '-'}</td><td>{labelFor(p.type)}</td><td>{money.format(Number(p.price || 0))}</td><td>{Number(p.price || 0) === 0 ? <Badge value="Sin precio" /> : <Badge value="Completo" />}</td><td>{(p.supplierPrices || []).slice(0, 3).map((sp: AnyRecord) => `${sp.supplier.name}: ${money.format(Number(sp.price))}`).join(' | ') || 'Sin proveedor'}</td></tr>)} /></section>
    </Page>
  );
}

function CustomersDirectory({ data, companyId, notify }: { data: AnyRecord; companyId: string; notify: Function }) {
  const [query, setQuery] = useState('');
  const customers = (data.customers || []).filter((customer: AnyRecord) => !query.trim() || `${customer.legalName} ${customer.cuit || ''} ${customer.address || ''}`.toLowerCase().includes(query.toLowerCase()));
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await notify('Cliente guardado.', () => postJson('/api/customers', { companyId, legalName: form.get('legalName'), cuit: form.get('cuit'), address: form.get('address'), taxCondition: form.get('taxCondition') }));
    event.currentTarget.reset();
  }
  return <Page eyebrow="Relaciones" title="Clientes" text="Datos fiscales y contactos para presupuestar y facturar." action={<span className="pageCount">{customers.length} clientes</span>}>
    <section className="directoryLayout"><form className="card form directoryForm" onSubmit={submit}><div><span className="pageEyebrow">Alta rápida</span><h2>Nuevo cliente</h2><p className="mutedText">Guardá los datos que vas a reutilizar en presupuestos y facturas.</p></div><Field label="Razón social" name="legalName" required /><Field label="CUIT" name="cuit" placeholder="20-12345678-9" /><Field label="Domicilio" name="address" /><Field label="Condición fiscal" name="taxCondition" placeholder="Responsable inscripto" /><button>Guardar cliente</button></form><div className="card directoryPanel"><div className="directoryHeader"><div><span className="pageEyebrow">Directorio</span><h2>Clientes registrados</h2></div><label className="inlineSearch"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cliente" aria-label="Buscar cliente" /></label></div><Table headers={['Razón social', 'CUIT', 'Domicilio']} rows={customers.map((customer: AnyRecord) => <tr key={customer.id}><td><strong>{customer.legalName}</strong><small>{customer.taxCondition || 'Condición fiscal pendiente'}</small></td><td>{customer.cuit || '—'}</td><td>{customer.address || '—'}</td></tr>)} /></div></section>
  </Page>;
}

function WhatsAppInbox({ data, companyId, notify }: { data: AnyRecord; companyId: string; notify: Function }) {
  const [query, setQuery] = useState('');
  const allMessages = data.whatsapp || [];
  const messages = allMessages.filter((message: AnyRecord) => !query.trim() || `${message.fromNumber} ${message.toNumber} ${message.body || ''} ${message.status || ''}`.toLowerCase().includes(query.toLowerCase()));
  const inbound = allMessages.filter((message: AnyRecord) => message.direction === 'INBOUND');
  const failed = allMessages.filter((message: AnyRecord) => message.status === 'failed');
  async function reprocess(messageId: string) {
    await notify('Mensaje reprocesado.', () => postJson(`/api/whatsapp/messages/${messageId}/reprocess`, { companyId }));
  }
  return <Page eyebrow="Canales" title="WhatsApp" text="Trazabilidad de mensajes entrantes, respuestas del bot y fallos de envío." action={<span className="pageCount">{messages.length} mensajes</span>}>
    <section className="whatsappOverview"><div className="whatsappStat"><span>Entrantes</span><strong>{inbound.length}</strong></div><div className="whatsappStat"><span>Fallos de envío</span><strong>{failed.length}</strong></div><div className="whatsappStat"><span>Con adjuntos</span><strong>{allMessages.filter((message: AnyRecord) => message.mediaDocument).length}</strong></div></section>
    <section className="card whatsappPanel"><div className="directoryHeader"><div><span className="pageEyebrow">Actividad del bot</span><h2>Mensajes recientes</h2></div><label className="inlineSearch"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar número, mensaje o estado" aria-label="Buscar WhatsApp" /></label></div><Table headers={['Dirección', 'Número', 'Tipo', 'Mensaje', 'Estado', 'Adjunto / acción']} rows={messages.map((message: AnyRecord) => <tr key={message.id}><td><Badge value={message.direction} /></td><td><strong>{message.direction === 'INBOUND' ? message.fromNumber : message.toNumber}</strong><small>{message.createdAt ? dateFmt.format(new Date(message.createdAt)) : 'Fecha no disponible'}</small></td><td><Badge value={message.messageType} /></td><td><span className="messagePreview">{message.body || 'Mensaje multimedia'}</span></td><td><Badge value={message.status || 'unknown'} /></td><td className="actions">{message.mediaDocument && <a href={`/api/documents/${message.mediaDocument.id}/content?companyId=${encodeURIComponent(companyId)}`} target="_blank" rel="noreferrer"><FileText size={14} /> {message.mediaDocument.fileName}</a>}{message.direction === 'INBOUND' && <button type="button" onClick={() => reprocess(message.id)}>Reprocesar</button>}{!message.mediaDocument && message.direction !== 'INBOUND' ? '—' : null}</td></tr>)} /></section>
  </Page>;
}

function SettingsCenter({ data, companyId, notify }: { data: AnyRecord; companyId: string; notify: Function }) {
  const [whatsappConfig, setWhatsappConfig] = useState<AnyRecord | null>(null);
  useEffect(() => { api<AnyRecord>('/api/whatsapp/config').then(setWhatsappConfig).catch(() => setWhatsappConfig(null)); }, []);
  const company = data.dashboard?.company;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = { legalName: form.get('legalName'), tradeName: form.get('tradeName'), cuit: form.get('cuit'), taxCondition: form.get('taxCondition') };
    if (companyId) {
      await notify('Empresa actualizada.', () => api<AnyRecord>(`/api/companies/${companyId}`, { method: 'PATCH', body: JSON.stringify(body) }));
    } else {
      const created = await notify('Empresa creada.', () => postJson<AnyRecord>('/api/companies', body));
      localStorage.setItem('companyId', created.id);
      location.reload();
    }
  }
  return <Page eyebrow="Sistema" title="Ajustes" text="Configurá la empresa y revisá el estado de tus integraciones."><section className="settingsLayout"><form key={company?.id || 'new'} className="card form directoryForm" onSubmit={submit}><div><span className="pageEyebrow">Identidad</span><h2>Datos de empresa</h2><p className="mutedText">Esta información aparece en tus documentos y comprobantes.</p></div><Field label="Razón social" name="legalName" defaultValue={company?.legalName || ''} required /><Field label="Nombre comercial" name="tradeName" defaultValue={company?.tradeName || ''} /><Field label="CUIT" name="cuit" defaultValue={company?.cuit || ''} required /><Field label="Condición fiscal" name="taxCondition" defaultValue={company?.taxCondition || 'Responsable Inscripto'} required /><button>{companyId ? 'Actualizar empresa' : 'Crear empresa'}</button></form><div className="settingsStack"><div className="card settingsCard"><div className="sectionRow"><div><span className="pageEyebrow">Integración</span><h2>WhatsApp</h2></div><Badge value={whatsappConfig?.canReceive && whatsappConfig?.canSend ? 'OK' : 'Falta config'} /></div><div className="statusList"><div className="statusRow"><span>Webhook</span><code>{whatsappConfig?.webhookUrl || 'No disponible'}</code></div><div className="statusRow"><span>App ID</span><strong>{whatsappConfig?.appId || 'No configurado'}</strong></div><div className="statusRow"><span>Operadores permitidos</span><Badge value={whatsappConfig?.operatorAllowlistConfigured ? 'OK' : 'Falta allowlist'} /></div><div className="statusRow"><span>Recibir mensajes</span><Badge value={whatsappConfig?.canReceive ? 'OK' : 'Falta config'} /></div><div className="statusRow"><span>Enviar documentos</span><Badge value={whatsappConfig?.canSend ? 'OK' : 'Falta token'} /></div></div></div><div className="card settingsCard"><span className="pageEyebrow">Facturación electrónica</span><h2>ARCA</h2><p className="mutedText">Configurá certificado, clave privada, CUIT y punto de venta en las variables del entorno de producción.</p><div className="integrationNotice"><CheckCircle2 size={16} /> La conexión se valida al autorizar una factura.</div></div></div></section></Page>;
}

function Customers({ data, companyId, notify }: { data: AnyRecord; companyId: string; notify: Function }) {
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await notify('Cliente guardado.', () => postJson('/api/customers', { companyId, legalName: form.get('legalName'), cuit: form.get('cuit'), address: form.get('address'), taxCondition: form.get('taxCondition') }));
  }
  return <Page title="Clientes" text="Datos fiscales y contactos para presupuestar/facturar."><section className="grid two"><form className="card form" onSubmit={submit}><h2>Nuevo cliente</h2><Field label="Razón social" name="legalName" required /><Field label="CUIT" name="cuit" /><Field label="Domicilio" name="address" /><Field label="Condición fiscal" name="taxCondition" /><button>Guardar</button></form><div className="card"><Table headers={['Razón social', 'CUIT', 'Domicilio']} rows={(data.customers || []).map((c: AnyRecord) => <tr key={c.id}><td>{c.legalName}</td><td>{c.cuit}</td><td>{c.address}</td></tr>)} /></div></section></Page>;
}

function WhatsApp({ data }: { data: AnyRecord }) {
  return <Page title="WhatsApp" text="Mensajes recibidos desde Meta Cloud API y adjuntos listos para revisión."><div className="card"><Table headers={['De', 'Tipo', 'Mensaje', 'Adjunto']} rows={(data.whatsapp || []).map((m: AnyRecord) => <tr key={m.id}><td>{m.fromNumber}</td><td>{labelFor(m.messageType)}</td><td>{m.body}</td><td>{m.mediaDocument ? m.mediaDocument.fileName : ''}</td></tr>)} /></div></Page>;
}

function SettingsView({ notify }: { notify: Function }) {
  const [whatsappConfig, setWhatsappConfig] = useState<AnyRecord | null>(null);

  useEffect(() => {
    api<AnyRecord>('/api/whatsapp/config').then(setWhatsappConfig).catch(() => setWhatsappConfig(null));
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const company = await notify('Empresa creada.', () => postJson<AnyRecord>('/api/companies', { legalName: form.get('legalName'), tradeName: form.get('tradeName'), cuit: form.get('cuit'), taxCondition: form.get('taxCondition') }));
    localStorage.setItem('companyId', company.id);
    location.reload();
  }

  return (
    <Page title="Ajustes" text="Datos base de empresa y configuraci�n de WhatsApp/ARCA.">
      <section className="grid two settingsLayout">
        <form className="card form" onSubmit={submit}>
          <h2>Empresa</h2>
          <Field label="Raz�n social" name="legalName" required />
          <Field label="Nombre comercial" name="tradeName" />
          <Field label="CUIT" name="cuit" required />
          <Field label="Condici�n fiscal" name="taxCondition" defaultValue="Responsable Inscripto" required />
          <button>Guardar empresa</button>
        </form>
        <div className="settingsStack">
          <div className="card">
            <h2>WhatsApp</h2>
            <div className="statusList">
              <div className="statusRow"><span>Webhook</span><code>{whatsappConfig?.webhookUrl || 'No disponible'}</code></div>
              <div className="statusRow"><span>App ID</span><strong>{whatsappConfig?.appId || 'No configurado'}</strong></div>
              <div className="statusRow"><span>WABA ID</span><strong>{whatsappConfig?.wabaId || 'No configurado'}</strong></div>
              <div className="statusRow"><span>Recibir mensajes</span><Badge value={whatsappConfig?.canReceive ? 'OK' : 'Falta config'} /></div>
              <div className="statusRow"><span>Enviar documentos</span><Badge value={whatsappConfig?.canSend ? 'OK' : 'Falta token'} /></div>
            </div>
          </div>
          <div className="card">
            <h2>ARCA y Meta</h2>
            <p>Configur� certificado, clave privada, CUIT, punto de venta y las variables de WhatsApp en Render. El webhook a registrar es el que figura arriba.</p>
          </div>
        </div>
      </section>
    </Page>
  );
}
