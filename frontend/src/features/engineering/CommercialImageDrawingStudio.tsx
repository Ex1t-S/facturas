import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Image, Link2, RefreshCw, Sparkles } from 'lucide-react';
import { api, postJson } from '../../api';

type AnyRecord = Record<string, any>;

const drawingTypes = [
  ['GRAIN_STORAGE_PLANT', 'Planta de almacenamiento'],
  ['COMPLETE_GRAIN_PLANT', 'Planta de granos completa'],
  ['SILO_GENERAL', 'Silo · lámina general'],
  ['SILO_PLANT', 'Silo · vista en planta'],
  ['SILO_ELEVATION', 'Silo · elevación'],
  ['BUCKET_ELEVATOR', 'Noria de cangilones'],
  ['SCREW_CONVEYOR', 'Transportador sinfín'],
  ['HOPPER', 'Tolva'],
  ['FEEDER', 'Alimentador'],
  ['DRAG_CONVEYOR', 'Transportador a cadena']
] as const;

function lines(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

export function CommercialImageDrawingStudio({ companyId }: { companyId: string }) {
  const [status, setStatus] = useState<AnyRecord | null>(null);
  const [quotes, setQuotes] = useState<AnyRecord[]>([]);
  const [quoteId, setQuoteId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<AnyRecord | null>(null);
  const [form, setForm] = useState({
    drawingType: 'GRAIN_STORAGE_PLANT',
    projectName: 'Planta de almacenamiento de granos',
    customerName: 'Cliente a confirmar',
    budgetNumber: 'PENDIENTE',
    title: 'Distribución general en planta',
    product: 'Trigo',
    capacity: '4 silos de 400 t',
    equipmentDescription: 'Planta general vista desde arriba con cuatro silos metálicos circulares dispuestos en matriz 2 × 2, noria central, recepción a la izquierda y despacho a la derecha.',
    equipmentList: 'Silo metálico 1 — 400 t\nSilo metálico 2 — 400 t\nSilo metálico 3 — 400 t\nSilo metálico 4 — 400 t\nNoria de cangilones — 150 t/h\nTransportador principal — 150 t/h\nTransportador sinfín — 150 t/h\nTolva de recepción\nSalida de despacho\nSala eléctrica\nPasarela de servicio\nCamino interno',
    approximateDimensions: 'Diámetro orientativo de silos: 15.000 mm\nSeparación orientativa: 5.000 mm\nSuperficie aproximada: 68.000 × 60.000 mm\nAltura orientativa de silos: 19.500 mm\nAltura orientativa de noria: 28.500 mm',
    requestedViews: 'Vista general en planta\nCorte frontal esquemático inferior\nTabla de equipos\nReferencias numeradas\nFlechas de flujo',
    additionalNotes: 'Incluir caminos y circulación de camiones\nRepresentación comercial orientativa para acompañar presupuesto'
  });

  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!companyId) return;
    Promise.all([
      api<AnyRecord>('/api/engineering/commercial-image-drawing/status').catch(() => null),
      api<AnyRecord[]>(`/api/quotes?companyId=${encodeURIComponent(companyId)}`).catch(() => [])
    ]).then(([currentStatus, quoteRows]) => {
      setStatus(currentStatus);
      setQuotes(quoteRows);
    });
  }, [companyId]);

  const payload = useMemo(() => ({
    companyId,
    drawingType: form.drawingType,
    equipmentType: drawingTypes.find(([id]) => id === form.drawingType)?.[1] || form.drawingType,
    projectName: form.projectName,
    customerName: form.customerName,
    budgetNumber: form.budgetNumber,
    budgetId: quoteId || undefined,
    title: form.title,
    product: form.product,
    capacity: form.capacity,
    equipmentDescription: form.equipmentDescription,
    equipmentList: lines(form.equipmentList),
    approximateDimensions: lines(form.approximateDimensions),
    requestedViews: lines(form.requestedViews),
    requestedDetails: [],
    additionalNotes: lines(form.additionalNotes),
    layoutDescription: '',
    generatedBy: 'Ingeniero Civil German Arroyo - ID 03136/5'
  }), [companyId, form, quoteId]);

  async function generate() {
    setBusy('generate');
    setError('');
    try {
      setResult(await postJson('/api/engineering/commercial-image-drawing', payload));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo generar la imagen.');
    } finally {
      setBusy('');
    }
  }

  async function associate() {
    if (!result?.drawingId || !quoteId) return;
    setBusy('associate');
    setError('');
    try {
      await postJson(`/api/engineering/commercial-image-drawings/${result.drawingId}/associate-budget`, { companyId, budgetId: quoteId });
      setResult((current: AnyRecord) => ({ ...current, associated: true }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo asociar al presupuesto.');
    } finally {
      setBusy('');
    }
  }

  return <section className="engineeringSection commercialImageStudio">
    <div className="sectionHeader">
      <div>
        <span className="eyebrow"><Sparkles size={14} /> Imagen técnica con IA</span>
        <h2>Plano visual comercial</h2>
        <p>Generá una lámina PNG profesional a partir de la plantilla FMH, lista para acompañar un presupuesto.</p>
      </div>
      <span className={`imageApiStatus ${status?.configured ? 'ready' : 'offline'}`}><span />{status?.configured ? `${status.model} disponible` : 'API de imágenes sin configurar'}</span>
    </div>

    <div className="commercialImageNotice"><AlertTriangle size={18} /><div><strong>Imagen orientativa generada con IA. No apta para fabricación.</strong><span>Las cotas y los detalles son comerciales; deben revisarse en la etapa de ingeniería.</span></div></div>
    {error && <div className="formWarning" role="alert">{error}</div>}

    <div className="commercialImageGrid">
      <div className="commercialImageForm">
        <article className="imageFormCard">
          <div className="imageFormCardHead"><span>01</span><div><h3>Documento</h3><p>Elegí el tipo y completá sólo lo que conozcas.</p></div></div>
          <div className="commercialFormGrid">
            <label><span>Tipo de plano</span><select value={form.drawingType} onChange={(event) => update('drawingType', event.target.value)}>{drawingTypes.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label><span>Título</span><input value={form.title} onChange={(event) => update('title', event.target.value)} /></label>
            <label><span>Proyecto</span><input value={form.projectName} onChange={(event) => update('projectName', event.target.value)} /></label>
            <label><span>Cliente</span><input value={form.customerName} onChange={(event) => update('customerName', event.target.value)} /></label>
            <label><span>Producto</span><input value={form.product} onChange={(event) => update('product', event.target.value)} /></label>
            <label><span>Capacidad</span><input value={form.capacity} onChange={(event) => update('capacity', event.target.value)} /></label>
            <label><span>N.º de presupuesto</span><input value={form.budgetNumber} onChange={(event) => update('budgetNumber', event.target.value)} /></label>
            <label><span>Asociar a presupuesto</span><select value={quoteId} onChange={(event) => {
              setQuoteId(event.target.value);
              const quote = quotes.find((item) => item.id === event.target.value);
              if (quote) {
                update('budgetNumber', `${quote.number}/${quote.version}`);
                if (quote.customer?.legalName) update('customerName', quote.customer.legalName);
              }
            }}><option value="">Sin asociar</option>{quotes.map((quote) => <option key={quote.id} value={quote.id}>#{quote.number} v{quote.version} · {quote.customer?.legalName || 'Cliente'}</option>)}</select></label>
          </div>
        </article>

        <article className="imageFormCard">
          <div className="imageFormCardHead"><span>02</span><div><h3>Contenido de la lámina</h3><p>Una línea por equipo, dimensión, vista o nota.</p></div></div>
          <label className="fullField"><span>Descripción libre</span><textarea rows={4} value={form.equipmentDescription} onChange={(event) => update('equipmentDescription', event.target.value)} /></label>
          <div className="commercialImageTextGrid">
            <label><span>Equipos</span><textarea rows={8} value={form.equipmentList} onChange={(event) => update('equipmentList', event.target.value)} /></label>
            <label><span>Dimensiones aproximadas</span><textarea rows={8} value={form.approximateDimensions} onChange={(event) => update('approximateDimensions', event.target.value)} /></label>
            <label><span>Vistas y elementos</span><textarea rows={6} value={form.requestedViews} onChange={(event) => update('requestedViews', event.target.value)} /></label>
            <label><span>Notas</span><textarea rows={6} value={form.additionalNotes} onChange={(event) => update('additionalNotes', event.target.value)} /></label>
          </div>
        </article>

        <div className="commercialImageActions">
          <button className="primaryButton" type="button" onClick={generate} disabled={busy === 'generate' || !status?.configured}><Sparkles size={17} />{busy === 'generate' ? 'Generando y evaluando…' : result ? 'Regenerar' : 'Generar plano visual'}</button>
          {result && <a className="buttonLike" href={result.imageUrl} download><Download size={16} /> Descargar PNG</a>}
          {result && quoteId && <button type="button" onClick={associate} disabled={busy === 'associate' || result.associated}><Link2 size={16} />{result.associated ? 'Asociado' : busy === 'associate' ? 'Asociando…' : 'Asociar al presupuesto'}</button>}
        </div>
      </div>

      <aside className="commercialImagePreview">
        <div className="imagePreviewHead"><div><span>Vista previa</span><strong>Lámina comercial FMH</strong></div>{result && <span className="imageScore">{Number(result.score).toFixed(1)} / 10</span>}</div>
        <div className="imagePreviewCanvas">
          {result
            ? <img src={result.imageUrl} alt={`Plano visual ${form.title}`} />
            : <div className="imagePreviewEmpty"><span><Image size={28} /></span><strong>Tu lámina aparecerá acá</strong><p>Se crearán dos alternativas, GPT-5.6 elegirá la mejor y se reintentará si la calidad es baja.</p></div>}
        </div>
        <div className="imagePreviewMeta">
          <div><span>Plantilla</span><strong>{result?.template || status?.template || 'plant-silos-a3-reference.png'}</strong></div>
          <div><span>Salida</span><strong>PNG · {status?.size || '2048×1440'} · calidad alta</strong></div>
          {result && <div><span>Intentos</span><strong>{result.attempts} · mejor alternativa guardada</strong></div>}
        </div>
        {result && <button className="regenerateLink" type="button" onClick={generate} disabled={busy === 'generate'}><RefreshCw size={15} /> Generar otra alternativa</button>}
      </aside>
    </div>
  </section>;
}
