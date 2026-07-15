import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Calculator,
  Check,
  ChevronDown,
  CircleHelp,
  DraftingCompass,
  FileText,
  FolderKanban,
  Library,
  Menu,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Upload,
  Wrench,
  X
} from 'lucide-react';
import { api, dateFmt, postJson } from '../../api';

type AnyRecord = Record<string, any>;
type EngineeringTab = 'assistant' | 'cases' | 'drawings' | 'library' | 'import';

const tabItems: Array<{ id: EngineeringTab; label: string; icon: typeof Sparkles }> = [
  { id: 'assistant', label: 'Asistente', icon: Sparkles },
  { id: 'cases', label: 'Casos', icon: FolderKanban },
  { id: 'drawings', label: 'Planos FMH', icon: DraftingCompass },
  { id: 'library', label: 'Biblioteca', icon: Library },
  { id: 'import', label: 'Importación', icon: Upload }
];

const engineeringLabels: Record<string, string> = {
  PRELIMINARY_DESIGN: 'Predimensionamiento',
  SUPPORTED_DETERMINISTIC: 'Calculado',
  PRELIMINARY_ASSISTED: 'Estimado',
  VERIFIED_INTERNAL: 'Verificado',
  HISTORICAL_PROJECT: 'Antecedente FMH',
  VERIFIED_TECHNICAL: 'Técnico verificado',
  REVIEWED: 'Revisado',
  HISTORICAL: 'Histórico',
  UNVERIFIED: 'Sin verificar',
  IRRELEVANT_FOR_ENGINEERING: 'No técnico',
  HISTORICAL: 'Histórico',
  NEEDS_REVIEW: 'Requiere revisión',
  NEEDS_VISION: 'Requiere revisión',
  EXTRACTED: 'Procesado',
  ANALYZED_LOCAL: 'Procesado',
  FAILED: 'Fallido',
  ORIENTATION: 'Orientación',
  CRITICAL: 'Necesario para continuar',
  IMPORTANT: 'Importante',
  OPTIONAL: 'Opcional',
  NO_PRICE: 'Precio pendiente',
  QUOTE: 'Presupuesto',
  OTHER: 'Otro',
  UNKNOWN: 'Sin clasificar',
  SILO: 'Silo',
  HOPPER: 'Tolva',
  WAREHOUSE: 'Galpón'
};

function labelFor(value?: string) {
  if (!value) return 'Sin estado';
  return engineeringLabels[value] || engineeringLabels[value.toUpperCase()] || value;
}

function toneFor(value?: string) {
  const key = String(value || '').toUpperCase();
  if (key.includes('FAIL') || key.includes('CRITICAL')) return 'danger';
  if (key.includes('REVIEW') || key.includes('PENDING') || key.includes('NEEDS')) return 'warn';
  if (key.includes('VERIFIED') || key.includes('EXTRACTED') || key.includes('ANALYZED') || key.includes('SUPPORTED')) return 'success';
  return 'neutral';
}

function StatusBadge({ value }: { value?: string }) {
  return <span className={`engineeringBadge ${toneFor(value)}`}><span className="badgeDot" />{labelFor(value)}</span>;
}

function EmptyState({ icon: Icon = CircleHelp, title, text, action }: { icon?: typeof CircleHelp; title: string; text: string; action?: React.ReactNode }) {
  return <div className="engineeringEmpty"><span className="emptyIcon"><Icon size={20} /></span><strong>{title}</strong><p>{text}</p>{action}</div>;
}

function EngineeringHeader({ tab, setTab }: { tab: EngineeringTab; setTab: (tab: EngineeringTab) => void }) {
  return <>
    <div className="engineeringHeader">
      <div>
        <div className="eyebrow"><Wrench size={14} /> Ingeniería FMH</div>
        <h1>Ingeniería</h1>
        <p>Asistente técnico, cálculos y antecedentes FMH</p>
      </div>
      {tab === 'assistant' && <div className="engineeringHeaderHint"><span className="statusPulse" /> Asistente listo</div>}
    </div>
    <nav className="engineeringNav" aria-label="Secciones de Ingeniería">
      {tabItems.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}><Icon size={16} />{label}</button>)}
    </nav>
  </>;
}

export function EngineeringPage({ companyId }: { companyId: string }) {
  const [tab, setTab] = useState<EngineeringTab>('assistant');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [focusConversationId, setFocusConversationId] = useState('');
  const changeTab = (next: EngineeringTab) => { setTab(next); setMobileNavOpen(false); };
  return <div className="engineeringPage">
    <EngineeringHeader tab={tab} setTab={changeTab} />
    <button className="engineeringMobileMenu" type="button" onClick={() => setMobileNavOpen((open) => !open)} aria-expanded={mobileNavOpen}><Menu size={16} /> Secciones <ChevronDown size={15} /></button>
    {mobileNavOpen && <div className="engineeringMobileNav">{tabItems.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => changeTab(id)}><Icon size={16} />{label}</button>)}</div>}
    {tab === 'assistant' && <AssistantView companyId={companyId} focusConversationId={focusConversationId} onRefresh={() => setRefreshKey((value) => value + 1)} />}
    {tab === 'cases' && <CasesView companyId={companyId} refreshKey={refreshKey} onOpenCase={(id) => { setFocusConversationId(id); changeTab('assistant'); }} />}
    {tab === 'drawings' && <DrawingsView companyId={companyId} />}
    {tab === 'library' && <><LibraryView companyId={companyId} /><GoldenLibraryPanel companyId={companyId} /></>}
    {tab === 'import' && <ImportView companyId={companyId} />}
  </div>;
}

function AssistantView({ companyId, focusConversationId, onRefresh }: { companyId: string; focusConversationId: string; onRefresh: () => void }) {
  const [message, setMessage] = useState('');
  const [conversations, setConversations] = useState<AnyRecord[]>([]);
  const [conversation, setConversation] = useState<AnyRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [search, setSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const steps = ['Buscando antecedentes FMH', 'Calculando cargas', 'Analizando planos similares', 'Preparando respuesta'];

  async function loadConversations() {
    if (!companyId) return;
    setConversations(await api<AnyRecord[]>(`/api/engineering/conversations?companyId=${companyId}`));
  }
  useEffect(() => { loadConversations().catch(() => undefined); }, [companyId]);
  useEffect(() => { if (focusConversationId) openConversation(focusConversationId).catch(() => undefined); }, [focusConversationId]);
  useEffect(() => { if (!loading) return; const timer = window.setInterval(() => setLoadingStep((step) => (step + 1) % steps.length), 1200); return () => window.clearInterval(timer); }, [loading]);
  async function newConversation() {
    const created = await postJson<AnyRecord>('/api/engineering/conversations', { companyId });
    setConversations((current) => [created, ...current.filter((item) => item.id !== created.id)]);
    setConversation({ ...created, messages: [] });
    setSidebarOpen(false);
  }
  async function openConversation(id: string) {
    const loaded = await api<AnyRecord>(`/api/engineering/conversations/${id}?companyId=${companyId}`);
    let state = {};
    try { state = loaded.stateJson ? JSON.parse(loaded.stateJson) : {}; } catch { state = {}; }
    setConversation({ ...loaded, state });
    setSidebarOpen(false);
  }
  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim() || !companyId || loading) return;
    const active = conversation || (await postJson<AnyRecord>('/api/engineering/conversations', { companyId }));
    if (!conversation) { setConversation({ ...active, messages: [] }); setConversations((current) => [active, ...current]); }
    setLoading(true); setLoadingStep(0);
    try {
      const response = await postJson<AnyRecord>(`/api/engineering/conversations/${active.id}/messages`, { companyId, message: message.trim() });
      setConversation((current) => current ? { ...current, messages: [...(current.messages || []), response.userMessage, response.assistantMessage], state: response.state } : current);
      setMessage('');
      await loadConversations();
      onRefresh();
    } finally { setLoading(false); }
  }
  async function saveCase() { if (conversation) { await postJson(`/api/engineering/conversations/${conversation.id}/save-case`, { companyId }); onRefresh(); } }
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
  const filteredConversations = conversations.filter((item) => !search.trim() || String(item.title || '').toLowerCase().includes(search.toLowerCase()));
  return <section className="assistantWorkspace">
    <button className="mobileConversationToggle" type="button" onClick={() => setSidebarOpen(true)}><Menu size={16} /> Conversaciones</button>
    {sidebarOpen && <button className="drawerBackdrop" aria-label="Cerrar conversaciones" onClick={() => setSidebarOpen(false)} />}
    <aside className={`conversationSidebar ${sidebarOpen ? 'open' : ''}`}>
      <div className="conversationSidebarHead"><div><span className="eyebrow">Workspace</span><h2>Conversaciones</h2></div><button className="iconButton closeDrawer" onClick={() => setSidebarOpen(false)} aria-label="Cerrar conversaciones"><X size={17} /></button></div>
      <button className="primaryButton newConversation" type="button" onClick={newConversation}><Plus size={16} /> Nueva conversación</button>
      <label className="engineeringSearch"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar conversación" aria-label="Buscar conversación" /></label>
      <div className="conversationList">{filteredConversations.map((item) => <button type="button" key={item.id} className={conversation?.id === item.id ? 'selected' : ''} onClick={() => openConversation(item.id)}><span className="conversationIcon"><MessageIcon /></span><span className="conversationCopy"><strong>{item.title || 'Nueva conversación'}</strong><small>{item.lastMessage?.content || 'Sin mensajes todavía'}</small></span><time>{item.updatedAt ? dateFmt.format(new Date(item.updatedAt)) : ''}</time></button>)}{!filteredConversations.length && <div className="conversationEmpty">No hay conversaciones que coincidan.</div>}</div>
      <div className="sidebarFoot"><span className="statusPulse" /> Memoria técnica FMH activa</div>
    </aside>
    <div className="conversationPanel">
      <header className="conversationHeader"><div><span className="conversationKicker"><Sparkles size={13} /> Asistente de Ingeniería</span><h2>{conversation?.title || 'Nueva consulta técnica'}</h2>{conversation && <span className="mutedText">{conversation.model || 'Modelo técnico FMH'}</span>}</div><div className="conversationActions">{conversation && <><button type="button" onClick={saveCase}><FolderKanban size={15} /> Guardar caso</button><button type="button" className="iconButton" aria-label="Más acciones"><MoreHorizontal size={17} /></button></>}</div></header>
      <div className="messageScroll" aria-live="polite">{!messages.length && !loading && <EmptyState icon={Sparkles} title="Empezá una consulta de ingeniería" text="Analizá un proyecto, compará alternativas o buscá antecedentes técnicos de FMH." action={<div className="suggestionRow"><button type="button" onClick={() => setMessage('Necesito comparar 4 contra 6 patas para un silo aéreo de 200 t.')}>Comparar apoyos</button><button type="button" onClick={() => setMessage('Buscá antecedentes FMH para una tolva.')}>Buscar antecedentes</button></div>} />}{messages.map((item: AnyRecord, index: number) => <EngineeringMessage key={item.id || index} item={item} />)}{loading && <div className="processingMessage"><span className="assistantAvatar"><Sparkles size={15} /></span><div><strong>{steps[loadingStep]}</strong><span className="processingDots"><i /><i /><i /></span></div></div>}</div>
      <form className="engineeringComposer" onSubmit={ask}><div className="composerField"><textarea ref={textareaRef} rows={1} value={message} onChange={(event) => { setMessage(event.target.value); event.currentTarget.style.height = 'auto'; event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 160)}px`; }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Escribí tu consulta de ingeniería…" aria-label="Consulta de ingeniería" /><span>Enter para enviar · Shift + Enter para una nueva línea</span></div><button className="sendButton" disabled={loading || !message.trim()} aria-label="Enviar consulta"><Send size={17} /></button></form>
    </div>
  </section>;
}

function MessageIcon() { return <BookOpen size={15} />; }

function EngineeringMessage({ item }: { item: AnyRecord }) {
  const isUser = item.role === 'user';
  const provider = item.provider || (() => { try { return JSON.parse(item.structuredResultJson || '{}').provider; } catch { return undefined; } })();
  const fallback = item.fallbackUsed || provider === 'local';
  return <article className={`engineeringMessage ${isUser ? 'user' : 'assistant'}`}>{!isUser && <span className="assistantAvatar"><Sparkles size={14} /></span>}<div className="messageBody"><span className="messageRole">{isUser ? 'Vos' : 'FMH · Asistente'}{!isUser && <small className={`assistantProvider ${fallback ? 'fallback' : ''}`}>{fallback ? 'Modo local temporal' : 'GPT-5.6 Sol'}</small>}</span><p>{item.content}</p>{!isUser && item.structuredResultJson && <TechnicalDetails result={item.structuredResultJson} />}</div></article>;
}

function TechnicalDetails({ result }: { result: AnyRecord | string }) {
  const parsed = typeof result === 'string' ? (() => { try { return JSON.parse(result); } catch { return { answer: result }; } })() : result;
  return <details className="technicalDetails"><summary><span>Ver análisis técnico</span><ChevronDown size={15} /></summary><div className="technicalContent"><div className="resultBadges"><StatusBadge value={parsed.level || 'ORIENTATION'} /><StatusBadge value={parsed.capability || 'PRELIMINARY_ASSISTED'} /></div>{parsed.missingData?.length > 0 && <TechnicalList title="Datos pendientes" items={parsed.missingData.map((item: AnyRecord) => `${labelFor(item.name)}: ${item.reason}`)} />}{parsed.assumptions?.length > 0 && <TechnicalList title="Hipótesis" items={parsed.assumptions} />}{parsed.calculations?.length > 0 && <div className="technicalSection"><h3><Calculator size={15} /> Cálculos realizados</h3><div className="calculationGrid">{parsed.calculations.map((item: AnyRecord) => <div className="calculationCard" key={item.title}><span>{item.title}</span><strong>{Number(item.result).toFixed(2)} {item.resultUnit}</strong><small>{item.formula}</small></div>)}</div></div>}{parsed.materials?.length > 0 && <TechnicalList title="Materiales preliminares" items={parsed.materials.map((item: AnyRecord) => `${item.description}: ${item.specification || 'Sección pendiente de confirmar'}`)} />}{parsed.sources?.length > 0 && <TechnicalProvenance sources={parsed.sources} />}{parsed.regulations?.length > 0 && <TechnicalList title="Normativa consultada" items={parsed.regulations.map((item: AnyRecord) => `${item.code} — ${labelFor(item.status)}`)} />}</div></details>;
}

function TechnicalProvenance({ sources }: { sources: AnyRecord[] }) {
  const groups = [
    ['Antecedentes FMH', sources.filter((item) => String(item.type || '').startsWith('FMH_PRECEDENT'))],
    ['Ejemplos resueltos / benchmarks', sources.filter((item) => String(item.type || '').includes('BENCHMARK'))],
    ['Catálogo estructural', sources.filter((item) => String(item.type || '').includes('CATALOG'))],
    ['Referencias internacionales', sources.filter((item) => String(item.type || '') === 'INTERNATIONAL_REFERENCE')]
  ] as const;
  return <>{groups.filter(([, items]) => items.length).map(([title, items]) => <TechnicalList key={title} title={title} items={items.map((item) => `${item.title}${item.excerpt ? ` — ${String(item.excerpt).slice(0, 180)}` : ''}`)} />)}</>;
}

function TechnicalList({ title, items }: { title: string; items: string[] }) {
  return <div className="technicalSection"><h3><FileText size={15} /> {title}</h3><ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>;
}

function SectionHeader({ eyebrow, title, text, action }: { eyebrow?: string; title: string; text?: string; action?: React.ReactNode }) {
  return <div className="sectionHeader"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2>{text && <p>{text}</p>}</div>{action}</div>;
}

function MetricStrip({ metrics }: { metrics: Array<{ label: string; value: string | number; icon: typeof FileText }> }) {
  return <div className="metricStrip">{metrics.map(({ label, value, icon: Icon }) => <div className="metricItem" key={label}><span className="metricIcon"><Icon size={15} /></span><div><span>{label}</span><strong>{value}</strong></div></div>)}</div>;
}

function CasesView({ companyId, onOpenCase }: { companyId: string; refreshKey?: number; onOpenCase: (id: string) => void }) {
  const [conversations, setConversations] = useState<AnyRecord[]>([]);
  useEffect(() => { if (companyId) api<AnyRecord[]>(`/api/engineering/conversations?companyId=${companyId}`).then(setConversations).catch(() => undefined); }, [companyId]);
  return <section className="engineeringSection"><SectionHeader eyebrow="Seguimiento" title="Casos de ingeniería" text="Tus consultas técnicas guardadas, listas para continuar." /><div className="caseGrid">{conversations.map((item) => <article className="caseCard" key={item.id}><div className="caseCardTop"><span className="caseIcon"><FolderKanban size={17} /></span><StatusBadge value={item.state?.status || 'PRELIMINARY_DESIGN'} /></div><h3>{item.title || 'Caso sin título'}</h3><p>{item.lastMessage?.content || 'Sin actividad registrada todavía.'}</p><footer><span>{item.updatedAt ? `Actualizado ${dateFmt.format(new Date(item.updatedAt))}` : 'Sin actividad'}</span><button type="button" onClick={() => onOpenCase(item.id)}>Abrir caso <span aria-hidden="true">→</span></button></footer></article>)}{!conversations.length && <EmptyState icon={FolderKanban} title="Todavía no hay casos guardados" text="Guardá una conversación para convertirla en un caso de ingeniería y continuar el análisis." />}</div></section>;
}

function DrawingsView({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<AnyRecord[]>([]);
  const [status, setStatus] = useState<AnyRecord | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  async function load() { const [rows, current] = await Promise.all([api<AnyRecord[]>(`/api/engineering/drawings?companyId=${companyId}&q=${encodeURIComponent(query)}`), api<AnyRecord>(`/api/engineering/drawings/status?companyId=${companyId}`)]); setItems(rows); setStatus(current); }
  useEffect(() => { if (companyId) load().catch(() => undefined); }, [companyId]);
  async function ingest() { setBusy(true); try { await postJson('/api/engineering/drawings/ingestion/start', { companyId }); await load(); } finally { setBusy(false); } }
  return <section className="engineeringSection"><SectionHeader eyebrow="Documentación visual" title="Planos FMH" text="Explorá planos históricos y referencias gráficas de proyectos anteriores." action={<button className="primaryButton" type="button" onClick={ingest} disabled={busy}>{busy ? <RefreshCw className="spin" size={16} /> : <Upload size={16} />} {busy ? 'Analizando…' : 'Importar planos'}</button>} /><MetricStrip metrics={[{ label: 'Planos', value: status?.total || 0, icon: DraftingCompass }, { label: 'Procesados', value: status?.counts?.ANALYZED_LOCAL || 0, icon: Check }, { label: 'Revisión', value: status?.counts?.NEEDS_REVIEW || 0, icon: AlertTriangle }]} /><div className="libraryToolbar"><label className="engineeringSearch wide"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') load(); }} placeholder="Buscar por silo, tolva, galpón o cliente" aria-label="Buscar planos" /></label><button type="button" onClick={() => load()}>Buscar</button><div className="viewToggle" aria-label="Modo de visualización"><button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label="Vista de cuadrícula">▦</button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="Vista de lista">☷</button></div></div><div className={`drawingGrid ${view}`}>{items.map((item) => <article className="drawingCard" key={item.id}><img src={`/api/engineering/drawings/${item.id}/thumbnail?companyId=${companyId}`} alt={`Miniatura de ${item.drawingTitle || item.fileName}`} /><div className="drawingInfo"><div className="drawingMeta"><StatusBadge value={item.status || 'HISTORICAL_PROJECT'} /><span>{item.template?.name || 'Plano FMH'}</span></div><h3>{item.drawingTitle || item.fileName}</h3><p>{labelFor(item.projectType)}{item.customerName ? ` · ${item.customerName}` : ''}</p><small>{item.createdAt ? dateFmt.format(new Date(item.createdAt)) : 'Fecha no disponible'}</small><a href={`/api/engineering/drawings/${item.id}/file?companyId=${companyId}`} target="_blank" rel="noreferrer">Abrir plano <span aria-hidden="true">→</span></a></div></article>)}{!items.length && <EmptyState icon={DraftingCompass} title="Todavía no hay planos procesados" text="Importá la carpeta de planos FMH para empezar a explorar antecedentes visuales." action={<button className="primaryButton" onClick={ingest}><Upload size={15} /> Importar planos</button>} />}</div></section>;
}

function LibraryView({ companyId }: { companyId: string }) {
  const [knowledge, setKnowledge] = useState<AnyRecord>({ documents: [] });
  const [status, setStatus] = useState<AnyRecord | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  async function load() { setLoading(true); try { const [rows, current] = await Promise.all([api<AnyRecord>(`/api/engineering/knowledge?companyId=${companyId}&take=50`), api<AnyRecord>(`/api/engineering/ingestion/status?companyId=${companyId}`)]); setKnowledge(rows); setStatus(current); } finally { setLoading(false); } }
  useEffect(() => { if (companyId) load().catch(() => undefined); }, [companyId]);
  const documents = (knowledge.documents || []).filter((doc: AnyRecord) => !query.trim() || `${doc.title} ${doc.sourcePath}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="engineeringSection"><SectionHeader eyebrow="Conocimiento interno" title="Biblioteca técnica FMH" text="Antecedentes, documentos procesados y fuentes para tus análisis." action={<button type="button" onClick={load}><RefreshCw size={16} /> Actualizar</button>} /><MetricStrip metrics={[{ label: 'Total', value: status?.totalFiles || 0, icon: Library }, { label: 'Procesados', value: status?.counts?.EXTRACTED || 0, icon: Check }, { label: 'Revisión', value: (status?.counts?.NEEDS_VISION || 0) + (status?.counts?.NEEDS_REVIEW || 0), icon: AlertTriangle }, { label: 'Fallidos', value: status?.counts?.FAILED || 0, icon: CircleHelp }]} /><div className="libraryToolbar"><label className="engineeringSearch wide"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar documentos, proyectos o clientes" aria-label="Buscar biblioteca" /></label><select aria-label="Filtrar documentos"><option>Todos los documentos</option><option>Procesados</option><option>Requieren revisión</option></select></div>{loading ? <div className="tableSkeleton"><span /><span /><span /><span /></div> : documents.length ? <div className="engineeringTableWrap"><table className="engineeringTable"><thead><tr><th>Documento</th><th>Tipo</th><th>Proyecto / cliente</th><th>Fecha</th><th>Estado</th><th /></tr></thead><tbody>{documents.map((doc: AnyRecord) => <tr key={doc.id}><td><div className="docName"><span className="fileIcon"><FileText size={16} /></span><span><strong>{doc.title || doc.fileName || 'Documento sin nombre'}</strong><small>{doc.sourcePath || 'Fuente interna FMH'}</small></span></div></td><td>{labelFor(doc.documentType || doc.type || 'OTHER')}</td><td>{doc.projectName || doc.customerName || '—'}</td><td>{doc.createdAt ? dateFmt.format(new Date(doc.createdAt)) : '—'}</td><td><StatusBadge value={doc.verified ? 'VERIFIED_INTERNAL' : doc.status || 'HISTORICAL_PROJECT'} /></td><td><button className="iconButton" aria-label={`Más acciones para ${doc.title || 'documento'}`}><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table></div> : <EmptyState icon={Library} title="La biblioteca todavía está vacía" text="Actualizá la biblioteca para procesar documentos técnicos y antecedentes FMH." action={<button className="primaryButton" onClick={load}><RefreshCw size={15} /> Actualizar biblioteca</button>} />}</section>;
}

function GoldenLibraryPanel({ companyId }: { companyId: string }) {
  const [data, setData] = useState<AnyRecord>({});
  const [sources, setSources] = useState<AnyRecord[]>([]);
  const [validations, setValidations] = useState<AnyRecord[]>([]);
  async function load() { const [library, sourceRows, validationRows] = await Promise.all([api<AnyRecord>(`/api/engineering/library?companyId=${companyId}&q=&take=12`), api<AnyRecord[]>(`/api/engineering/sources?companyId=${companyId}`), api<AnyRecord[]>(`/api/engineering/validations?companyId=${companyId}`)]); setData(library); setSources(sourceRows); setValidations(validationRows); }
  useEffect(() => { if (companyId) load().catch(() => undefined); }, [companyId]);
  return <section className="engineeringSection goldenPanel"><SectionHeader eyebrow="Procedencia y validación" title="Golden Library" text="La recuperación separa fuentes oficiales, ejemplos, antecedentes FMH, catálogo y referencias internacionales." action={<button type="button" onClick={load}><RefreshCw size={16} /> Actualizar</button>} /><div className="goldenLibraryGrid"><article className="goldenLibraryCard"><h3><BookOpen size={16} /> Fuentes</h3>{sources.slice(0, 8).map((source) => <div className="goldenRow" key={source.id}><strong>{source.title}</strong><span>{source.publisher} · {source.jurisdiction} · {source.sourceType}</span><StatusBadge value={source.verificationStatus} /><small>{source.downloadStatus} {source.fileHash ? `· SHA ${String(source.fileHash).slice(0, 12)}…` : ''}</small></div>)}{!sources.length && <p className="mutedText">Todavía no hay fuentes sincronizadas.</p>}</article><article className="goldenLibraryCard"><h3><FileText size={16} /> Ejemplos resueltos / benchmarks</h3>{(data.benchmarks || []).slice(0, 8).map((benchmark: AnyRecord) => <div className="goldenRow" key={benchmark.id}><strong>{benchmark.title}</strong><span>{benchmark.standardCode || 'Norma pendiente'} · {benchmark.source?.title || 'Fuente pendiente'}</span><StatusBadge value={benchmark.verified ? 'VERIFIED' : benchmark.status} /></div>)}{!data.benchmarks?.length && <p className="mutedText">La extracción inicial queda pendiente de revisión humana.</p>}</article><article className="goldenLibraryCard"><h3><FolderKanban size={16} /> Proyectos FMH</h3>{(data.fmhPrecedents || []).slice(0, 8).map((item: AnyRecord) => <div className="goldenRow" key={item.id}><strong>{item.title}</strong><span>{labelFor(item.type)} · {item.customerName || 'Cliente no identificado'}</span><StatusBadge value={item.trustLevel} /></div>)}{!data.fmhPrecedents?.length && <p className="mutedText">No hay antecedentes indexados.</p>}</article><article className="goldenLibraryCard"><h3><Wrench size={16} /> Catálogo estructural</h3>{(data.sectionCandidates || []).slice(0, 8).map((item: AnyRecord) => <div className="goldenRow" key={item.id}><strong>{item.designation}</strong><span>{item.material || 'Material pendiente'} · {item.sourceTitle}</span><StatusBadge value={item.verified ? 'VERIFIED' : item.source} /></div>)}{!data.sectionCandidates?.length && <p className="mutedText">Sin secciones verificadas. No se inventan propiedades faltantes.</p>}</article><article className="goldenLibraryCard"><h3><Check size={16} /> Validación de herramientas</h3>{validations.slice(0, 8).map((item) => <div className="goldenRow" key={item.id}><strong>{item.toolName} {item.toolVersion}</strong><span>{item.benchmark?.title || item.benchmarkId}</span><StatusBadge value={item.passed ? 'PASSED' : 'FAILED'} /></div>)}{!validations.length && <p className="mutedText">No hay benchmarks verificados todavía; las herramientas permanecen sin validar.</p>}</article></div></section>;
}

function ImportView({ companyId }: { companyId: string }) {
  const [status, setStatus] = useState<AnyRecord | null>(null);
  const [busy, setBusy] = useState(false);
  async function load() { setStatus(await api<AnyRecord>(`/api/engineering/ingestion/status?companyId=${companyId}`)); }
  useEffect(() => { if (companyId) load().catch(() => undefined); }, [companyId]);
  async function ingest() { setBusy(true); try { await postJson('/api/engineering/ingestion/start', { companyId }); await load(); } finally { setBusy(false); } }
  const counts = status?.counts || {};
  const total = Number(status?.totalFiles || 0);
  const processed = Number(counts.EXTRACTED || 0);
  const progress = total ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  return <section className="engineeringSection importSection"><SectionHeader eyebrow="Procesos" title="Importación" text="Mantené actualizada la biblioteca técnica sin interrumpir tu trabajo." action={<button className="primaryButton" type="button" onClick={ingest} disabled={busy}>{busy ? <RefreshCw className="spin" size={16} /> : <Upload size={16} />} {busy ? 'Actualizando…' : 'Actualizar biblioteca'}</button>} /><div className="importGrid"><article className="importCard importStatusCard"><div className="importCardHead"><span className="cardIcon"><RefreshCw size={18} /></span><div><h3>Estado de la biblioteca</h3><span className="mutedText">Última actualización disponible</span></div></div><div className="progressRing"><strong>{progress}%</strong><span>procesado</span></div><div className="progressTrack"><span style={{ width: `${progress}%` }} /></div><div className="importStats"><span><strong>{processed}</strong> procesados</span><span><strong>{counts.NEEDS_REVIEW || 0}</strong> requieren revisión</span><span><strong>{counts.FAILED || 0}</strong> fallidos</span></div></article><article className="importCard"><div className="importCardHead"><span className="cardIcon"><Library size={18} /></span><div><h3>Carpeta configurada</h3><span className="mutedText">Origen de documentos técnicos</span></div></div><p className="folderPath">{status?.latest?.rootPath || status?.root || 'Carpeta de documentos FMH configurada en el entorno'}</p><div className="importDetail"><span>Archivos encontrados</span><strong>{total}</strong></div></article><article className="importCard"><div className="importCardHead"><span className="cardIcon"><FileText size={18} /></span><div><h3>Archivos pendientes</h3><span className="mutedText">Esperando procesamiento</span></div></div><strong className="largeNumber">{Number(counts.PENDING || 0)}</strong><p className="mutedText">Se procesarán durante la próxima actualización.</p></article></div><div className="importNote"><CircleHelp size={16} /><span>La importación se ejecuta en segundo plano. Podés seguir trabajando mientras se actualiza la biblioteca.</span></div></section>;
}
