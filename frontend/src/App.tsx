import { useEffect, useMemo, useState } from 'react';
import { Archive, Bot, ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Home, PackageSearch, ReceiptText, Send, Settings, Upload, Users, Wrench } from 'lucide-react';
import { api, dateFmt, money, postJson } from './api';

type View = 'dashboard' | 'assistant' | 'engineering' | 'documents' | 'quotes' | 'invoices' | 'inventory' | 'customers' | 'whatsapp' | 'settings';
type AnyRecord = Record<string, any>;

const nav: Array<{ id: View; label: string; icon: typeof Home }> = [
  { id: 'dashboard', label: 'Panel', icon: Home },
  { id: 'assistant', label: 'Asistente', icon: Bot },
  { id: 'engineering', label: 'Ingeniería FMH', icon: Wrench },
  { id: 'documents', label: 'Documentos', icon: Archive },
  { id: 'quotes', label: 'Presupuestos', icon: ReceiptText },
  { id: 'invoices', label: 'Facturas', icon: ReceiptText },
  { id: 'inventory', label: 'Inventario', icon: PackageSearch },
  { id: 'customers', label: 'Clientes', icon: Users },
  { id: 'whatsapp', label: 'WhatsApp', icon: Send },
  { id: 'settings', label: 'Ajustes', icon: Settings }
];

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
  document_message: 'Documento'
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
  const tone = String(value || '').toLowerCase().includes('pending') || String(value || '').toLowerCase().includes('needs') || String(value || '').toLowerCase().includes('uploaded') ? 'warn' : 'ok';
  return <span className={`badge ${tone}`}>{labelFor(value)}</span>;
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className="empty"><strong>{title}</strong><span>{text}</span></div>;
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="field"><span>{props.label}</span><input {...props} /></label>;
}

function SelectField(props: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{props.label}</span><select {...props}>{props.children}</select></label>;
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

  const companyName = data.dashboard?.company?.tradeName || data.dashboard?.company?.legalName || 'Sin empresa';

  async function notify<T>(message: string, work: () => Promise<T>) {
    setBusy(true);
    try {
      const result = await work();
      setToast(message);
      setTimeout(() => setToast(''), 2800);
      await load();
      return result;
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Error inesperado');
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
  const [customers, products, quotes, invoices, documents, inventory, suppliers, whatsapp] = activeCompanyId
      ? await Promise.all([
          api<AnyRecord[]>(`/api/customers?companyId=${activeCompanyId}`),
          api<AnyRecord[]>(`/api/products?companyId=${activeCompanyId}&take=300`),
          api<AnyRecord[]>(`/api/quotes?companyId=${activeCompanyId}`),
          api<AnyRecord[]>(`/api/invoices?companyId=${activeCompanyId}`),
          api<AnyRecord[]>(`/api/documents?companyId=${activeCompanyId}&take=300`),
          api<AnyRecord>(`/api/inventory?companyId=${activeCompanyId}`),
          api<AnyRecord[]>(`/api/suppliers?companyId=${activeCompanyId}`),
          api<AnyRecord[]>('/api/whatsapp/messages')
        ])
      : [[], [], [], [], await api<AnyRecord[]>('/api/documents?take=300'), {}, [], await api<AnyRecord[]>('/api/whatsapp/messages')];
    setData({ dashboard, customers, products, quotes, invoices, documents, inventory, suppliers, whatsapp });
  }

  useEffect(() => {
    load().catch((error) => setToast(error.message));
  }, [companyId]);

  const content = useMemo(() => {
    if (view === 'documents') return <Documents data={data} companyId={companyId} notify={notify} />;
    if (view === 'assistant') return <AssistantView companyId={companyId} />;
    if (view === 'engineering') return <EngineeringView companyId={companyId} />;
    if (view === 'quotes') return <Quotes data={data} companyId={companyId} notify={notify} />;
    if (view === 'invoices') return <Invoices data={data} companyId={companyId} notify={notify} />;
    if (view === 'inventory') return <Inventory data={data} companyId={companyId} notify={notify} />;
    if (view === 'customers') return <Customers data={data} companyId={companyId} notify={notify} />;
    if (view === 'whatsapp') return <WhatsApp data={data} />;
    if (view === 'settings') return <SettingsView notify={notify} />;
    return <Dashboard data={data} setView={setView} />;
  }, [view, data, companyId]);

  return (
    <div className="shell">
      <aside>
        <div className="brand"><strong>FMH Gestión</strong><span>Presupuestos, remitos, inventario y ARCA</span></div>
        <nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon size={18} />{label}</button>)}</nav>
      </aside>
      <main>
        <header className="topbar">
          <div className="company"><span>Empresa activa</span><strong>{companyName}</strong></div>
        </header>
        {busy && <div className="loading">Procesando...</div>}
        {content}
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Page({ title, text, action, children }: { title: string; text: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <><div className="pageHead"><div><h1>{title}</h1><p>{text}</p></div>{action}</div>{children}</>;
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
    const chat = await api<AnyRecord>(`/api/assistant/chats/${chatId}/messages`);
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
      const response = await postJson<{ assistantMessage: AnyRecord; userMessage: AnyRecord }>(`/api/assistant/chats/${chatId}/messages`, {
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
    <Page title="Asistente IA" text="Consultas y acciones sobre documentos reales.">
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
            {messages.map((message, index) => (
              <div className={`bubble ${message.role}`} key={message.id || index}>
                <span>{message.role === 'assistant' ? 'Asistente' : 'Vos'}</span>
                <p>{message.content}</p>
                {message.documentId && message.actionType === 'delivery_note_created' && (
                  <div className="messageActions">
                    <a href={`/api/documents/${message.documentId}/content`} target="_blank"><FileText size={16} /> Ver remito</a>
                  </div>
                )}
              </div>
            ))}
            {loading && <div className="bubble assistant"><span>Asistente</span><p>Procesando...</p></div>}
          </div>
          <form className="chatComposer" onSubmit={(event) => { event.preventDefault(); ask(text); }}>
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} placeholder="Escribi la consulta o pedido..." />
            <button disabled={loading || !text.trim()}><Send size={16} />Enviar</button>
          </form>
        </div>
      </section>
    </Page>
  );
}

function EngineeringView({ companyId }: { companyId: string }) {
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<AnyRecord | null>(null);
  const [knowledge, setKnowledge] = useState<AnyRecord>({ documents: [] });
  const [status, setStatus] = useState<AnyRecord | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadLibrary() {
    if (!companyId) return;
    const [library, ingestion] = await Promise.all([
      api<AnyRecord>(`/api/engineering/knowledge?companyId=${companyId}&q=&take=30`),
      api<AnyRecord>(`/api/engineering/ingestion/status?companyId=${companyId}`)
    ]);
    setKnowledge(library); setStatus(ingestion);
  }
  useEffect(() => { loadLibrary().catch(() => undefined); }, [companyId]);
  async function ask(event: React.FormEvent) {
    event.preventDefault(); if (!message.trim() || !companyId) return;
    setLoading(true);
    try { setResult(await postJson<AnyRecord>('/api/engineering/chat', { companyId, message })); } finally { setLoading(false); }
  }
  async function startIngestion() {
    if (!companyId) return;
    await postJson('/api/engineering/ingestion/start', { companyId });
    setTimeout(() => loadLibrary().catch(() => undefined), 800);
  }
  const totalFiles = Object.values(status?.counts || {}).reduce((sum: number, value: any) => sum + Number(value), 0);
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
  const [filters, setFilters] = useState({ q: '', kind: '', extractionStatus: '', customer: '', cuit: '', dateFrom: '', dateTo: '', hasText: '' });
  const [documents, setDocuments] = useState<AnyRecord[]>(data.documents || []);
  const [tree, setTree] = useState<AnyRecord | null>(null);
  const [selectedPath, setSelectedPath] = useState<{ kind?: string; year?: string; month?: number }>({});
  const [preview, setPreview] = useState<{ document: AnyRecord; data: AnyRecord } | null>(null);

  async function loadDocuments(next = filters) {
    if (!companyId) return;
    const qs = queryString({
      companyId,
      take: 500,
      ...next,
      kind: selectedPath.kind || next.kind,
      year: selectedPath.year,
      month: selectedPath.month,
      customer: next.customer,
      hasText: next.hasText === '' ? undefined : next.hasText
    });
    const [rows, treeData] = await Promise.all([
      api<AnyRecord[]>(`/api/documents?${qs}`),
      api<AnyRecord>(`/api/documents/tree?${queryString({ companyId, q: next.q, customer: next.customer, kind: next.kind, take: 1800 })}`)
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

  function selectFolder(path: { kind?: string; year?: string; month?: number }) {
    setSelectedPath(path);
    setFilters((current) => ({ ...current, kind: path.kind || '' }));
  }

  async function openPreview(document: AnyRecord) {
    const data = await api<AnyRecord>(`/api/documents/${document.id}/preview`);
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
        <button onClick={() => notify('Documento extraído.', () => postJson(`/api/documents/${d.id}/extract`, {})).then(() => loadDocuments())}>Extraer</button>
        <button onClick={() => notify('Borrador creado.', () => postJson(`/api/documents/${d.id}/create-quote-draft`, { companyId })).then(() => loadDocuments())}>Presupuesto</button>
      </td>
    </tr>
  ));

  return (
    <Page title="Documentos" text="Importá históricos, filtrá presupuestos/facturas/remitos y convertí adjuntos en borradores editables." action={<button onClick={() => notify('Importación histórica finalizada.', () => postJson('/api/documents/import-historical', { companyId, limit })).then(() => loadDocuments())}><Upload size={16} /> Importar</button>}>
      <div className="toolbar wide"><Field label="Límite de importación" type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></div>
      <section className="card filters">
        <Field label="Buscar" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Cliente, CUIT, archivo, material..." />
        <SelectField label="Tipo" value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value })}>{documentKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
        <SelectField label="Extracción" value={filters.extractionStatus} onChange={(e) => setFilters({ ...filters, extractionStatus: e.target.value })}>
          <option value="">Todas</option><option value="UPLOADED">Subido</option><option value="STRUCTURED">Estructurado</option><option value="NEEDS_REVIEW">Revisar</option><option value="FAILED">Fallido</option>
        </SelectField>
        <Field label="Cliente" value={filters.customer} onChange={(e) => setFilters({ ...filters, customer: e.target.value })} />
        <Field label="CUIT" value={filters.cuit} onChange={(e) => setFilters({ ...filters, cuit: e.target.value })} />
        <Field label="Desde" type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} />
        <Field label="Hasta" type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} />
        <SelectField label="Texto" value={filters.hasText} onChange={(e) => setFilters({ ...filters, hasText: e.target.value })}><option value="">Todos</option><option value="true">Con texto</option><option value="false">Sin texto/OCR</option></SelectField>
        <button onClick={() => { setSelectedPath({}); loadDocuments({ ...filters }); }}>Aplicar filtros</button>
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
        <div className="previewOverlay" role="dialog" aria-modal="true">
          <div className="previewPanel">
            <div className="previewHead">
              <div><strong>{preview.document.displayName || preview.document.fileName}</strong><span>{preview.document.displayCustomer || preview.document.issuerName || preview.document.kind}</span></div>
              <button type="button" onClick={() => setPreview(null)}>Cerrar</button>
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

function Quotes({ data, companyId, notify }: { data: AnyRecord; companyId: string; notify: Function }) {
  const customers = data.customers || [];
  const products = data.products || [];
  const [lines, setLines] = useState<QuoteDraftLine[]>([
    { productId: '', description: '', quantity: 1, unit: 'unidad', unitPrice: 0, taxRate: 21 }
  ]);
  const [marginPercent, setMarginPercent] = useState(0);
  const [expandedLine, setExpandedLine] = useState(0);

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
    const form = new FormData(event.currentTarget);
    await notify('Presupuesto creado.', () => postJson('/api/quotes/draft-from-items', {
      companyId,
      customerId: String(form.get('customerId')),
      marginPercent,
      notes: String(form.get('notes') || ''),
      items: lines
        .filter((line) => line.description.trim() && Number(line.quantity) > 0)
        .map((line) => ({
          productId: line.productId || undefined,
          description: line.description,
          quantity: Number(line.quantity),
          unit: line.unit,
          unitPrice: Number(line.unitPrice),
          taxRate: Number(line.taxRate)
        }))
    }));
  }

  return (
    <Page title="Presupuestos" text="Crear y descargar presupuestos.">
      <section className="grid two">
        <form className="card form quoteBuilder" onSubmit={submit}>
          <div className="sectionRow"><h2>Nuevo borrador FMH</h2><button type="button" onClick={addLine}>Agregar item</button></div>
          <SelectField label="Cliente" name="customerId">{customers.map((c: AnyRecord) => <option value={c.id} key={c.id}>{c.legalName}</option>)}</SelectField>
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
                      <Field label="Cantidad" type="number" step="0.01" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} required />
                      <Field label="Unidad" value={line.unit} onChange={(event) => updateLine(index, { unit: event.target.value })} />
                      <Field label="Precio" type="number" step="0.01" value={line.unitPrice} onChange={(event) => updateLine(index, { unitPrice: Number(event.target.value) })} required />
                      <Field label="IVA %" type="number" step="0.01" value={line.taxRate} onChange={(event) => updateLine(index, { taxRate: Number(event.target.value) })} />
                    </div>
                  </>
                )}
              </div>
            );
          })}
          <Field label="Margen general %" type="number" step="0.01" value={marginPercent} onChange={(event) => setMarginPercent(Number(event.target.value))} />
          <Field label="Notas" name="notes" />
          <div className="quoteTotals">
            <span>Subtotal: {money.format(preview.subtotal)}</span>
            <span>IVA: {money.format(preview.tax)}</span>
            <strong>Total: {money.format(preview.total)}</strong>
          </div>
          <button>Crear borrador</button>
        </form>
        <div className="card"><h2>Listado</h2><Table headers={['N°', 'Cliente', 'Estado', 'Total', 'Descargas']} rows={(data.quotes || []).map((q: AnyRecord) => <tr key={q.id}><td>#{q.number}</td><td>{q.customer.legalName}</td><td><Badge value={q.status} /></td><td>{money.format(Number(q.total))}</td><td className="actions"><a href={`/api/quotes/${q.id}/docx`} target="_blank"><FileText size={16} /> DOCX</a><a href={`/api/quotes/${q.id}/pdf`} target="_blank"><FileText size={16} /> PDF</a></td></tr>)} /></div>
      </section>
    </Page>
  );
}

function Invoices({ data, notify }: { data: AnyRecord; companyId: string; notify: Function }) {
  const invoices = data.invoices || [];
  const quotes = data.quotes || [];

  async function createDraft(quoteId: string, type: 'A' | 'B') {
    await notify('Borrador de factura creado.', () => postJson('/api/quotes/' + quoteId + '/invoice-draft', { type }));
  }

  async function authorize(invoiceId: string) {
    await notify('Factura enviada a ARCA.', () => postJson('/api/invoices/' + invoiceId + '/authorize-arca', {}));
  }

  return (
    <Page title="Facturas" text="Prepará comprobantes A o B y revisalos antes de enviarlos a ARCA.">
      <section className="card invoiceCreate">
        <div className="sectionRow"><div><h2>Crear desde presupuesto</h2><p className="mutedText">Elegí un presupuesto y el tipo de comprobante.</p></div></div>
        <div className="invoiceCreateGrid">
          {quotes.slice(0, 12).map((quote: AnyRecord) => (
            <div className="invoiceQuoteCard" key={quote.id}>
              <strong>Presupuesto #{quote.number}</strong>
              <span>{quote.customer?.legalName || 'Cliente sin nombre'}</span>
              <b>{money.format(Number(quote.total || 0))}</b>
              <div className="actions"><button type="button" onClick={() => createDraft(quote.id, 'A')}>Factura A</button><button type="button" onClick={() => createDraft(quote.id, 'B')}>Factura B</button></div>
            </div>
          ))}
          {!quotes.length && <Empty title="Sin presupuestos" text="Creá un presupuesto para preparar una factura." />}
        </div>
      </section>
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
