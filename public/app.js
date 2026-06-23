const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
const dateFmt = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });

const state = {
  view: location.hash.replace('#/', '') || 'dashboard',
  companyId: localStorage.getItem('companyId') || '',
  lastQuoteId: localStorage.getItem('lastQuoteId') || '',
  dashboard: null,
  customers: [],
  products: [],
  quotes: [],
  documents: [],
  suppliers: [],
  priceComparison: [],
  whatsappMessages: [],
  inventory: { products: [], suggestions: [], supplierPrices: [] },
  selectedDocument: null,
  selectedPreview: null,
  toast: ''
};

const routes = [
  ['dashboard', 'Panel', 'P'],
  ['files', 'Ficheros', 'F'],
  ['import', 'Importar', 'I'],
  ['quotes', 'Presupuestos', 'Q'],
  ['billing', 'ARCA', 'A'],
  ['customers', 'Clientes', 'C'],
  ['inventory', 'Inventario', 'V'],
  ['suppliers', 'Proveedores', '$'],
  ['whatsapp', 'WhatsApp', 'W'],
  ['settings', 'Ajustes', 'S']
];

function setState(patch) {
  Object.assign(state, patch);
  if (patch.companyId !== undefined) localStorage.setItem('companyId', patch.companyId);
  if (patch.lastQuoteId !== undefined) localStorage.setItem('lastQuoteId', patch.lastQuoteId);
  render();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.error || response.statusText);
  return data;
}

async function postJson(path, body) {
  return api(path, { method: 'POST', body: JSON.stringify(body) });
}

async function loadData() {
  const dashboard = await api(`/api/dashboard${state.companyId ? `?companyId=${state.companyId}` : ''}`);
  const companyId = dashboard.company?.id || state.companyId;
  const [customers, products, quotes, documents, inventory, suppliers, priceComparison, whatsappMessages] = companyId
    ? await Promise.all([
        api(`/api/customers?companyId=${companyId}`),
        api(`/api/products?companyId=${companyId}`),
        api(`/api/quotes?companyId=${companyId}`),
        api('/api/documents'),
        api(`/api/inventory?companyId=${companyId}`),
        api(`/api/suppliers?companyId=${companyId}`),
        api(`/api/price-comparison?companyId=${companyId}`),
        api('/api/whatsapp/messages')
      ])
    : [[], [], [], await api('/api/documents'), { products: [], suggestions: [], supplierPrices: [] }, [], [], await api('/api/whatsapp/messages')];
  setState({ dashboard, companyId, customers, products, quotes, documents, inventory, suppliers, priceComparison, whatsappMessages });
}

function toast(message) {
  state.toast = message;
  render();
  setTimeout(() => {
    state.toast = '';
    render();
  }, 3200);
}

function badge(value) {
  const key = String(value || 'UNKNOWN').toLowerCase();
  const labels = {
    unknown: 'Sin clasificar',
    draft: 'Borrador',
    sent: 'Enviado',
    accepted: 'Aceptado',
    rejected: 'Rechazado',
    pending_review: 'Pendiente de revision',
    reviewed: 'Revisado',
    archived: 'Archivado',
    uploaded: 'Subido',
    needs_review: 'Revisar',
    extracted: 'Extraido',
    failed: 'Error',
    pending_confirmation: 'Pendiente de confirmar',
    authorized: 'Autorizada',
    cancelled: 'Cancelada',
    paid: 'Pagada',
    invoice: 'Factura',
    quote: 'Presupuesto',
    receipt: 'Remito',
    remittance: 'Remito',
    supplier_price_list: 'Lista de precios',
    other: 'Otro'
  };
  const tone = key.includes('pending') || key.includes('needs') || key.includes('failed') ? 'warn' : key.includes('review') || key.includes('sent') || key.includes('authorized') ? 'ok' : '';
  return `<span class="status ${tone}">${labels[key] || String(value || 'Sin estado').replaceAll('_', ' ')}</span>`;
}

function emptyState(title, text, action = '') {
  return `<div class="empty-state"><strong>${title}</strong><p>${text}</p>${action}</div>`;
}

function pageHeader(title, subtitle, actions = '') {
  return `<header class="page-header"><div><span class="eyebrow">Orden operativo</span><h1>${title}</h1><p>${subtitle}</p></div><div class="header-actions">${actions}</div></header>`;
}

function table(headers, rows, empty = 'Todavía no hay registros.') {
  if (!rows.length) return emptyState('Sin datos', empty);
  return `<div class="table-wrap"><table class="table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function metric(label, value, detail, tone = '') {
  return `<article class="card metric ${tone} span-3"><span>${label}</span><strong>${value}</strong><p>${detail}</p></article>`;
}

function appShell(content) {
  const companyName = state.dashboard?.company?.tradeName || state.dashboard?.company?.legalName || 'Sin empresa';
  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark"><img src="/assets/fmh-logo.png" alt="" onerror="this.style.display='none'" /><span>FMH</span></div>
          <div><strong>FMH Gestion</strong><small>Documentos, presupuestos y compras</small></div>
        </div>
        <nav class="nav">
          ${routes.map(([id, label, icon]) => `<button class="${state.view === id ? 'active' : ''}" data-nav="${id}"><span>${icon}</span>${label}</button>`).join('')}
        </nav>
        <div class="sidebar-card"><span class="pulse"></span><div><strong>Sistema operativo</strong><small>ARCA con autorizacion manual · WhatsApp preparado</small></div></div>
      </aside>
      <main class="main">
        <div class="topbar">
          <div class="company-chip"><small>Empresa activa</small><strong>${companyName}</strong></div>
        </div>
        <section class="view-enter">${content}</section>
      </main>
      ${state.toast ? `<div class="toast">${state.toast}</div>` : ''}
    </div>
  `;
}

function dashboardView() {
  const stats = state.dashboard?.stats || {};
  const bestPrices = state.priceComparison.filter((row) => row.best).length;
  return `
    ${pageHeader('Panel de control', 'Vista diaria para revisar documentos, cotizar, comparar proveedores y ordenar el taller.', '<button class="btn btn-primary" data-view="inventory">Comparar precios</button>')}
    <section class="grid">
      ${metric('Clientes', stats.customers || 0, 'Contactos fiscales cargados', 'accent-a')}
      ${metric('Productos', stats.products || 0, 'Catálogo e inventario base', 'accent-b')}
      ${metric('Mejores precios', bestPrices, 'Productos con proveedor sugerido', 'accent-c')}
      ${metric('Por revisar', stats.documentsPending || 0, 'Documentos pendientes', 'accent-d')}
      <div class="card span-7">
        <div class="section-head"><h2>Presupuestos recientes</h2><button class="btn btn-ghost" data-view="quotes">Ver todos</button></div>
        ${table(['N°', 'Cliente', 'Estado', 'Total'], (state.dashboard?.recentQuotes || []).map((q) => `<tr><td>#${q.number}</td><td>${q.customer.legalName}</td><td>${badge(q.status)}</td><td>${money.format(Number(q.total))}</td></tr>`))}
      </div>
      <div class="card span-5">
        <div class="section-head"><h2>Compras sugeridas</h2><button class="btn btn-ghost" data-view="inventory">Abrir</button></div>
        ${table(['Producto', 'Mejor proveedor', 'Precio'], state.priceComparison.filter((r) => r.best).slice(0, 5).map((r) => `<tr><td>${r.product.name}</td><td>${r.best.supplier.name}</td><td>${money.format(Number(r.best.price))}</td></tr>`), 'Cargá listas de proveedores para comparar.')}
      </div>
    </section>
  `;
}

function filesView() {
  const rows = state.documents.map((d) => `
    <tr class="${state.selectedDocument?.id === d.id ? 'selected-row' : ''}">
      <td><strong>${d.fileName}</strong><small>${d.mimeType}</small></td>
      <td>${badge(d.kind)}</td>
      <td>${badge(d.extractionStatus || d.status)}</td>
      <td>${d.createdAt ? dateFmt.format(new Date(d.createdAt)) : ''}</td>
      <td class="table-actions"><button class="btn btn-primary" data-preview="${d.id}">Ver</button><a class="btn btn-ghost" href="/api/documents/${d.id}/download">Descargar</a></td>
    </tr>
  `);

  return `
    ${pageHeader('Ficheros', 'Archivo central de PDFs, Word, facturas, presupuestos y adjuntos de WhatsApp.', '<button class="btn btn-primary" data-view="import">Importar</button>')}
    <section class="grid">
      <div class="card span-7"><div class="section-head"><h2>Registros documentales</h2><span>${state.documents.length} archivos</span></div>${table(['Archivo', 'Tipo', 'Proceso', 'Fecha', 'Acciones'], rows, 'Subi documentos para revisar y previsualizar dentro del sistema.')}</div>
      <div class="card preview-card span-5"><div class="section-head"><h2>Vista previa</h2>${state.selectedDocument ? `<a class="btn btn-ghost" href="/api/documents/${state.selectedDocument.id}/content" target="_blank">Abrir aparte</a>` : ''}</div>${renderPreview()}</div>
    </section>
  `;
}

function renderPreview() {
  if (!state.selectedDocument) return emptyState('Seleccioná un archivo', 'PDF y DOCX se visualizan dentro del panel sin descargarlos.');
  if (!state.selectedPreview) return emptyState('Cargando preview', 'La vista previa se está preparando.');
  if (state.selectedPreview.type === 'pdf') return `<iframe class="doc-frame" src="${state.selectedPreview.url}" title="Vista PDF"></iframe>`;
  if (state.selectedPreview.type === 'html') return `<article class="doc-html">${state.selectedPreview.html}</article>`;
  return emptyState('Preview no disponible', state.selectedPreview.message);
}

function importView() {
  return `
    ${pageHeader('Importar documentos', 'Cargá facturas, presupuestos, remitos, Word, planillas o listas de precios.')}
    <section class="grid">
      <div class="card span-5">
        <h2>Nuevo archivo</h2>
        <form id="documentForm" class="dropzone"><div><p><strong>Seleccioná un PDF, DOCX, Excel o imagen</strong></p><input name="file" type="file" required /><p>Se guarda en ficheros y queda pendiente de revisión.</p><button class="btn btn-primary">Subir documento</button></div></form>
      </div>
      <div class="card span-7"><div class="section-head"><h2>Bandeja de revisión</h2><button class="btn btn-ghost" data-view="files">Ver ficheros</button></div>${table(['Archivo', 'Tipo', 'Estado', 'Extracción'], state.documents.map((d) => `<tr><td>${d.fileName}</td><td>${d.mimeType}</td><td>${badge(d.extractionStatus)}</td><td>${d.extraction?.extractedJson || ''}</td></tr>`))}</div>
    </section>
  `;
}

function quotesView() {
  return `
    ${pageHeader('Presupuestos', 'Cotización rápida con PDF y conversión posterior a factura borrador.')}
    <section class="grid">
      <div class="card span-5">
        <h2>Nuevo presupuesto</h2>
        <form id="quoteForm" class="form-grid">
          <label class="field full">Cliente<select name="customerId">${state.customers.map((c) => `<option value="${c.id}">${c.legalName}</option>`).join('')}</select></label>
          <label class="field full">Descripción<input name="description" value="Fabricación y plegado según plano" /></label>
          <label class="field">Cantidad<input name="quantity" type="number" value="1" min="0.01" step="0.01" /></label>
          <label class="field">Precio unitario<input name="unitPrice" type="number" value="10000" min="0" step="0.01" /></label>
          <label class="field full">Notas<textarea name="notes" rows="3" placeholder="Condiciones de pago, plazo de entrega, observaciones técnicas"></textarea></label>
          <button class="btn btn-primary">Crear presupuesto</button><button class="btn btn-ghost" type="button" data-open-pdf>Último PDF</button>
        </form>
      </div>
      <div class="card span-7"><h2>Listado</h2>${table(['N°', 'Cliente', 'Estado', 'Total', 'Acciones'], state.quotes.map((q) => `<tr><td>#${q.number}</td><td>${q.customer.legalName}</td><td>${badge(q.status)}</td><td>${money.format(Number(q.total))}</td><td class="table-actions"><button class="btn btn-ghost" data-pdf="${q.id}">PDF</button><button class="btn btn-secondary" data-invoice="${q.id}">Factura borrador</button></td></tr>`))}</div>
    </section>
  `;
}

function customersView() {
  return `
    ${pageHeader('Clientes', 'Datos fiscales, contactos e historial comercial.')}
    <section class="grid">
      <div class="card span-4"><h2>Nuevo cliente</h2><form id="customerForm" class="form-grid"><label class="field full">Razón social<input name="legalName" required /></label><label class="field">CUIT<input name="cuit" /></label><label class="field">Teléfono<input name="phone" /></label><label class="field full">Condición fiscal<input name="taxCondition" placeholder="Responsable Inscripto, Monotributo..." /></label><button class="btn btn-primary">Guardar</button></form></div>
      <div class="card span-8"><h2>Base de clientes</h2>${table(['Razón social', 'CUIT', 'Teléfono', 'Condición'], state.customers.map((c) => `<tr><td>${c.legalName}</td><td>${c.cuit || ''}</td><td>${c.phone || ''}</td><td>${c.taxCondition || ''}</td></tr>`))}</div>
    </section>
  `;
}

function inventoryView() {
  return `
    ${pageHeader('Inventario general', 'Productos normalizados, precios actualizables y comparación entre proveedores.', '<button class="btn btn-primary" data-view="suppliers">Cargar lista</button>')}
    <section class="grid">
      <div class="card span-5">
        <h2>Nuevo producto</h2>
        <form id="productForm" class="form-grid">
          <label class="field full">Nombre<input name="name" required /></label>
          <label class="field">Categoría<input name="category" placeholder="Material, servicio, producto" /></label>
          <label class="field">Unidad<input name="unit" value="unidad" /></label>
          <label class="field">Precio venta<input name="price" type="number" value="0" min="0" /></label>
          <button class="btn btn-primary">Guardar producto</button>
        </form>
      </div>
      <div class="card span-7">
        <h2>Mejor precio por producto</h2>
        ${table(['Producto', 'Proveedor recomendado', 'Precio', 'Alternativas', 'Ahorro'], state.priceComparison.map((row) => `<tr><td><strong>${row.product.name}</strong><small>${row.product.category || ''}</small></td><td>${row.best ? row.best.supplier.name : 'Sin precio'}</td><td>${row.best ? money.format(Number(row.best.price)) : '-'}</td><td>${row.alternatives?.length || 0}</td><td>${row.savingsVsCurrent ? money.format(Number(row.savingsVsCurrent)) : '-'}</td></tr>`), 'Cargá precios de proveedores para comparar.')}</div>
      <div class="card span-12"><h2>Catálogo</h2>${table(['SKU', 'Nombre', 'Categoría', 'Unidad', 'Costo base', 'Venta'], state.products.map((p) => `<tr><td>${p.sku || ''}</td><td>${p.name}</td><td>${p.category || ''}</td><td>${p.unit}</td><td>${money.format(Number(p.baseCost || 0))}</td><td>${money.format(Number(p.price))}</td></tr>`))}</div>
    </section>
  `;
}

function suppliersView() {
  return `
    ${pageHeader('Proveedores y precios', 'Cargá listas manuales o importadas para mantener costos actualizados y elegir el mejor proveedor.')}
    <section class="grid">
      <div class="card span-4">
        <h2>Nuevo proveedor</h2>
        <form id="supplierForm" class="form-grid">
          <label class="field full">Nombre<input name="name" placeholder="Codimat, Rattini..." required /></label>
          <label class="field full">Sitio web<input name="website" placeholder="https://..." /></label>
          <label class="field">Teléfono<input name="phone" /></label>
          <label class="field">Email<input name="email" type="email" /></label>
          <button class="btn btn-primary">Guardar proveedor</button>
        </form>
      </div>
      <div class="card span-8">
        <h2>Cargar precio rápido</h2>
        <form id="supplierPriceForm" class="form-grid">
          <label class="field">Proveedor<select name="supplierId">${state.suppliers.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select></label>
          <label class="field">Producto<select name="productId"><option value="">Sin vincular</option>${state.products.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select></label>
          <label class="field full">Nombre en lista<input name="name" placeholder="Chapa 1/8 1.22x2.44" required /></label>
          <label class="field">Unidad<input name="unit" value="unidad" /></label>
          <label class="field">Precio<input name="price" type="number" min="0" step="0.01" required /></label>
          <label class="field">Moneda<input name="currency" value="ARS" /></label>
          <button class="btn btn-primary">Agregar a lista</button>
        </form>
      </div>
      <div class="card span-5"><h2>Proveedores</h2>${table(['Nombre', 'Web', 'Precios'], state.suppliers.map((s) => `<tr><td>${s.name}</td><td>${s.website ? `<a href="${s.website}" target="_blank">${s.website}</a>` : ''}</td><td>${s._count?.prices || 0}</td></tr>`), 'Cargá proveedores para empezar.')}</div>
      <div class="card span-7"><h2>Precios cargados</h2>${table(['Proveedor', 'Producto/lista', 'Precio', 'Vinculado'], state.inventory.supplierPrices.map((p) => `<tr><td>${p.supplier.name}</td><td>${p.rawName}</td><td>${money.format(Number(p.price))}</td><td>${p.productId ? 'Sí' : 'No'}</td></tr>`), 'Todavía no hay precios cargados.')}</div>
    </section>
  `;
}

function billingView() {
  return `${pageHeader('Facturación ARCA', 'Bandeja fiscal con confirmación humana antes de autorizar CAE.')}<div class="card feature-card"><h2>Integración segura</h2><p>La app crea borradores de factura desde presupuestos. La autorización real queda bloqueada hasta configurar certificado, CUIT, punto de venta Web Services y homologación WSAA/WSFEv1.</p><p>Regla operativa: WhatsApp o IA pueden preparar datos, pero no emitir sin confirmación humana.</p></div>`;
}

function whatsappView() {
  return `
    ${pageHeader('WhatsApp', 'Bandeja de mensajes de Meta Cloud API y adjuntos recibidos como ficheros.', '<button class="btn btn-primary" data-copy-webhook>Copiar webhook</button>')}
    <section class="grid">
      <div class="card span-5 feature-card"><h2>Configuracion para Meta</h2><p>Usar la URL publica de Render cuando se cargue el webhook.</p><p><strong>Callback:</strong> <code>https://fmh-gestion.onrender.com/webhooks/whatsapp</code></p><p><strong>Verify token:</strong> el valor de <code>WHATSAPP_VERIFY_TOKEN</code></p><p><strong>Evento:</strong> mensajes</p></div>
      <div class="card span-7"><h2>Mensajes recientes</h2>${table(['De', 'Tipo', 'Mensaje', 'Adjunto'], state.whatsappMessages.map((m) => `<tr><td>${m.fromNumber}</td><td>${m.messageType}</td><td>${m.body || ''}</td><td>${m.mediaDocument ? `<button class="btn btn-ghost" data-preview="${m.mediaDocument.id}">Ver fichero</button>` : ''}</td></tr>`), 'Todavía no llegaron mensajes al webhook.')}</div>
    </section>
  `;
}

function settingsView() {
  return `${pageHeader('Configuración', 'Alta de empresa, ARCA y canales externos.')}<section class="grid"><div class="card span-6"><h2>Empresa</h2><form id="companyForm" class="form-grid"><label class="field full">Razón social<input name="legalName" value="FMH" /></label><label class="field">CUIT<input name="cuit" placeholder="CUIT de la empresa" /></label><label class="field">Condición fiscal<input name="taxCondition" value="Responsable Inscripto" /></label><button class="btn btn-primary">Crear empresa</button></form></div><div class="card span-6 feature-card"><h2>ARCA</h2><p>Pendiente: cargar certificado, clave privada, CUIT y punto de venta Web Services. No guardar clave fiscal.</p></div></section>`;
}

function currentView() {
  if (state.view === 'files') return filesView();
  if (state.view === 'import') return importView();
  if (state.view === 'quotes') return quotesView();
  if (state.view === 'billing') return billingView();
  if (state.view === 'customers') return customersView();
  if (state.view === 'inventory') return inventoryView();
  if (state.view === 'suppliers') return suppliersView();
  if (state.view === 'whatsapp') return whatsappView();
  if (state.view === 'settings') return settingsView();
  return dashboardView();
}

function render() {
  document.querySelector('#app').innerHTML = appShell(currentView());
  bindEvents();
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function openPreview(documentId) {
  const doc = state.documents.find((item) => item.id === documentId) || state.whatsappMessages.find((m) => m.mediaDocument?.id === documentId)?.mediaDocument;
  setState({ selectedDocument: doc, selectedPreview: null, view: 'files' });
  const preview = await api(`/api/documents/${documentId}/preview`);
  setState({ selectedDocument: doc, selectedPreview: preview, view: 'files' });
}

function bindEvents() {
  document.querySelectorAll('[data-nav], [data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.nav || button.dataset.view;
      history.replaceState(null, '', `#/${view}`);
      setState({ view });
    });
  });

  document.querySelector('#companyForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const company = await postJson('/api/companies', formData(event.currentTarget));
    toast('Empresa creada.');
    setState({ companyId: company.id });
    await loadData();
  });

  document.querySelector('#customerForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await postJson('/api/customers', { ...formData(event.currentTarget), companyId: state.companyId });
    toast('Cliente guardado.');
    await loadData();
  });

  document.querySelector('#productForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    await postJson('/api/products', { ...data, companyId: state.companyId, price: Number(data.price) });
    toast('Producto guardado.');
    await loadData();
  });

  document.querySelector('#supplierForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    await postJson('/api/suppliers', { ...data, companyId: state.companyId });
    toast('Proveedor guardado.');
    await loadData();
  });

  document.querySelector('#supplierPriceForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    if (!data.supplierId) return toast('Primero cargá un proveedor.');
    await postJson(`/api/suppliers/${data.supplierId}/prices`, {
      companyId: state.companyId,
      name: 'Carga manual',
      items: [{
        productId: data.productId || undefined,
        name: data.name,
        unit: data.unit,
        currency: data.currency,
        price: Number(data.price),
        taxIncluded: true
      }]
    });
    toast('Precio cargado.');
    await loadData();
  });

  document.querySelector('#quoteForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = formData(event.currentTarget);
    const quote = await postJson('/api/quotes', {
      companyId: state.companyId,
      customerId: data.customerId,
      notes: data.notes,
      items: [{ description: data.description, quantity: Number(data.quantity), unitPrice: Number(data.unitPrice) }]
    });
    toast('Presupuesto creado.');
    setState({ lastQuoteId: quote.id });
    await loadData();
  });

  document.querySelector('#documentForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await api('/api/documents', { method: 'POST', body: new FormData(event.currentTarget) });
    toast('Documento subido para revisión.');
    await loadData();
  });

  document.querySelectorAll('[data-preview]').forEach((button) => {
    button.addEventListener('click', async () => openPreview(button.dataset.preview).catch((error) => toast(error.message)));
  });

  document.querySelectorAll('[data-pdf]').forEach((button) => {
    button.addEventListener('click', () => window.open(`/api/quotes/${button.dataset.pdf}/pdf`, '_blank'));
  });

  document.querySelector('[data-open-pdf]')?.addEventListener('click', () => {
    if (!state.lastQuoteId) return toast('Primero creá un presupuesto.');
    window.open(`/api/quotes/${state.lastQuoteId}/pdf`, '_blank');
  });

  document.querySelectorAll('[data-invoice]').forEach((button) => {
    button.addEventListener('click', async () => {
      await postJson(`/api/quotes/${button.dataset.invoice}/invoice-draft`, { type: 'B' });
      toast('Factura borrador creada. Falta confirmación ARCA.');
      await loadData();
    });
  });

  document.querySelector('[data-copy-webhook]')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText('https://fmh-gestion.onrender.com/webhooks/whatsapp');
    toast('Webhook copiado.');
  });
}

window.addEventListener('hashchange', () => setState({ view: location.hash.replace('#/', '') || 'dashboard' }));

render();
loadData().catch((error) => {
  toast(error.message);
  render();
});
