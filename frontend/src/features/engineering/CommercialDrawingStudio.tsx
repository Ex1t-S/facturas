import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Download, DraftingCompass, Eye, Save, Sparkles } from 'lucide-react';
import { api, postJson } from '../../api';

type AnyRecord = Record<string, any>;

const originLabels: Record<string, string> = {
  USER_INPUT: 'Ingresado',
  CALCULATED: 'Calculado',
  DESIGN_PACK: 'Regla del paquete',
  MANUFACTURER_REFERENCE: 'Fabricante',
  STANDARD_REFERENCE: 'Norma',
  PUBLIC_TECHNICAL_REFERENCE: 'Referencia pública',
  ILLUSTRATIVE_ASSUMPTION: 'Asumido'
};

const fieldLabels: Record<string, string> = {
  diameter: 'Diámetro',
  cylindricalHeight: 'Altura cilíndrica',
  roofHeight: 'Altura de techo',
  hopperHeight: 'Altura de cono',
  dischargeClearance: 'Altura libre',
  outletDiameter: 'Diámetro de descarga',
  supportPitchDiameter: 'Diámetro entre apoyos',
  supportCount: 'Cantidad de apoyos',
  totalHeight: 'Altura total',
  visualRings: 'Anillos visuales',
  floorLevel: 'Nivel de piso',
  requiredUsefulVolume: 'Volumen útil requerido',
  cylinderVolume: 'Volumen cilíndrico',
  hopperVolume: 'Volumen de cono',
  geometricVolume: 'Volumen geométrico',
  estimatedCapacity: 'Capacidad aproximada',
  capacityDifference: 'Diferencia de capacidad'
};

function positive(value: string) {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function CommercialDrawingStudio({ companyId }: { companyId: string }) {
  const [description, setDescription] = useState('Necesito un silo para 400 toneladas de trigo, fondo cónico, con descarga a 4 metros del piso.');
  const [fields, setFields] = useState({
    projectName: 'Silo de trigo 400 t',
    customerName: 'Cliente a confirmar',
    material: 'trigo',
    capacity: '400',
    density: '',
    diameter: '',
    bodyHeight: '',
    roofHeight: '',
    hopperHeight: '',
    clearance: '4',
    outletDiameter: '',
    supportCount: ''
  });
  const [titleBlock, setTitleBlock] = useState({
    drawnBy: 'FMH Ingeniería',
    reviewedBy: 'Ingeniero Civil German Arroyo - ID 03136/5',
    approvedBy: 'PENDIENTE',
    observations: 'Representación orientativa; ingeniería pendiente.'
  });
  const [quoteId, setQuoteId] = useState('');
  const [quotes, setQuotes] = useState<AnyRecord[]>([]);
  const [aiStatus, setAiStatus] = useState<AnyRecord | null>(null);
  const [drawing, setDrawing] = useState<AnyRecord | null>(null);
  const [saved, setSaved] = useState<AnyRecord | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const update = (key: keyof typeof fields, value: string) => setFields((current) => ({ ...current, [key]: value }));
  const updateTitle = (key: keyof typeof titleBlock, value: string) => setTitleBlock((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!companyId) return;
    Promise.all([
      api<AnyRecord[]>(`/api/quotes?companyId=${encodeURIComponent(companyId)}`).catch(() => []),
      api<AnyRecord>('/api/engineering/v2/ai/status').catch(() => null)
    ]).then(([quoteRows, status]) => {
      setQuotes(quoteRows);
      setAiStatus(status);
    });
  }, [companyId]);

  function currentRequest() {
    const dimensions: Record<string, number> = {};
    const dimensionFields = {
      diameter: positive(fields.diameter),
      cylindricalHeight: positive(fields.bodyHeight),
      roofHeight: positive(fields.roofHeight),
      hopperHeight: positive(fields.hopperHeight),
      dischargeClearance: positive(fields.clearance),
      outletDiameter: positive(fields.outletDiameter)
    };
    Object.entries(dimensionFields).forEach(([key, value]) => {
      if (value) dimensions[key] = value * 1000;
    });
    return {
      schemaVersion: '2.0',
      equipmentType: 'SILO',
      projectName: fields.projectName.trim() || 'Propuesta comercial orientativa',
      customerName: fields.customerName.trim() || 'Cliente a confirmar',
      productOrMaterial: fields.material.trim() || 'trigo',
      capacity: positive(fields.capacity) || 400,
      capacityUnit: 't',
      requestedDimensions: dimensions,
      siteRestrictions: [],
      preferredConfiguration: {
        siloType: 'METALLIC_SUPPORTED',
        bottomType: 'CONICAL',
        roofType: 'CONICAL',
        ...(positive(fields.supportCount) ? { supportCount: Math.floor(positive(fields.supportCount)!) } : {})
      },
      requiredComponents: ['ladder', 'safetyCage', 'platform', 'railing'],
      optionalComponents: ['inspectionHatch', 'ventilation'],
      operatingConditions: positive(fields.density) ? { bulkDensityKgM3: positive(fields.density)! } : {},
      userNotes: [],
      sourceConversationId: null,
      sourceBudgetId: quoteId || null
    };
  }

  const titleBlockPayload = () => {
    const quote = quotes.find((item) => item.id === quoteId);
    return {
      project: fields.projectName,
      customer: fields.customerName,
      quoteNumber: quote?.number ? String(quote.number) : 'PENDIENTE',
      ...titleBlock
    };
  };

  async function interpret() {
    setBusy('interpret');
    setError('');
    try {
      const response = await postJson<AnyRecord>('/api/engineering/v2/designs/interpret', { description, budgetId: quoteId || null });
      if (!response.request) throw new Error(`Solicitud incompleta: ${(response.missingData || []).join(', ')}`);
      const request = response.request;
      const dimensions = request.requestedDimensions || {};
      setFields((current) => ({
        ...current,
        projectName: request.projectName || current.projectName,
        customerName: request.customerName || current.customerName,
        material: request.productOrMaterial || current.material,
        capacity: request.capacity ? String(request.capacity) : current.capacity,
        density: request.operatingConditions?.bulkDensityKgM3 ? String(request.operatingConditions.bulkDensityKgM3) : current.density,
        diameter: dimensions.diameter ? String(dimensions.diameter / 1000) : current.diameter,
        bodyHeight: dimensions.cylindricalHeight ? String(dimensions.cylindricalHeight / 1000) : current.bodyHeight,
        roofHeight: dimensions.roofHeight ? String(dimensions.roofHeight / 1000) : current.roofHeight,
        hopperHeight: dimensions.hopperHeight ? String(dimensions.hopperHeight / 1000) : current.hopperHeight,
        clearance: dimensions.dischargeClearance ? String(dimensions.dischargeClearance / 1000) : current.clearance,
        outletDiameter: dimensions.outletDiameter ? String(dimensions.outletDiameter / 1000) : current.outletDiameter,
        supportCount: request.preferredConfiguration?.supportCount ? String(request.preferredConfiguration.supportCount) : current.supportCount
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo interpretar la solicitud.');
    } finally {
      setBusy('');
    }
  }

  async function generate() {
    setBusy('generate');
    setError('');
    try {
      setDrawing(await postJson('/api/engineering/v2/designs', { request: currentRequest(), titleBlock: titleBlockPayload() }));
      setSaved(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo generar el plano.');
    } finally {
      setBusy('');
    }
  }

  function downloadSvg() {
    if (!drawing?.svg) return;
    const url = URL.createObjectURL(new Blob([drawing.svg], { type: 'image/svg+xml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${drawing.result?.drawingSpec?.drawingNumber || 'plano-fmh'}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function downloadPdf() {
    setBusy('pdf');
    setError('');
    try {
      const response = await fetch('/api/engineering/v2/designs/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: currentRequest(), titleBlock: titleBlockPayload() })
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'No se pudo generar el PDF.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `${drawing?.result?.drawingSpec?.drawingNumber || 'plano-fmh'}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo descargar el PDF.');
    } finally {
      setBusy('');
    }
  }

  async function saveDrawing() {
    setBusy('save');
    setError('');
    try {
      const endpoint = saved?.drawing?.id ? `/api/engineering/v2/drawings/${saved.drawing.id}/revisions` : '/api/engineering/v2/drawings';
      setSaved(await postJson(endpoint, {
        companyId,
        request: currentRequest(),
        titleBlock: titleBlockPayload(),
        generatedBy: 'Ingeniero Civil German Arroyo - ID 03136/5'
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar la revisión.');
    } finally {
      setBusy('');
    }
  }

  const values = drawing?.result
    ? [...Object.entries(drawing.result.equipmentGeometry || {}), ...Object.entries(drawing.result.calculatedValues || {})]
    : [];
  const selectedQuote = quotes.find((quote) => quote.id === quoteId);
  return <section className="engineeringSection commercialDrawingStudio">
    <div className="sectionHeader"><div><span className="eyebrow">Diseño paramétrico</span><h2>Plano comercial orientativo</h2><p>Definí el equipo, revisá las hipótesis y generá una hoja A3 para acompañar el presupuesto.</p></div></div>
    {error && <div className="formWarning" role="alert">{error}</div>}
    <div className="commercialStudioGrid">
      <div className="commercialStudioControls">
        <article className="commercialStepCard">
          <div className="stepHeading"><span>1</span><div><h3>Describí el equipo</h3><p>Codex extrae datos; no calcula ni dibuja.</p></div></div>
          <textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} />
          <button type="button" onClick={interpret} disabled={busy === 'interpret' || !aiStatus?.authenticated}><Sparkles size={16} /> {busy === 'interpret' ? 'Interpretando…' : 'Interpretar con Codex'}</button>
          <small className={aiStatus?.authenticated ? 'aiAvailable' : 'aiUnavailable'}>{aiStatus?.authenticated ? `Codex disponible · ${aiStatus.model}` : 'Codex no autenticado. El formulario determinístico sigue disponible.'}</small>
        </article>
        <article className="commercialStepCard">
          <div className="stepHeading"><span>2</span><div><h3>Datos conocidos</h3><p>Los campos vacíos se registrarán como hipótesis.</p></div></div>
          <div className="commercialFormGrid">
            <label><span>Equipo</span><select disabled><option>Silo</option></select></label>
            <label><span>Producto</span><input value={fields.material} onChange={(event) => update('material', event.target.value)} /></label>
            <label><span>Capacidad (t)</span><input value={fields.capacity} onChange={(event) => update('capacity', event.target.value)} /></label>
            <label><span>Densidad (kg/m³)</span><input placeholder="Referencial" value={fields.density} onChange={(event) => update('density', event.target.value)} /></label>
            <label><span>Diámetro (m)</span><input placeholder="Automático" value={fields.diameter} onChange={(event) => update('diameter', event.target.value)} /></label>
            <label><span>Altura cilíndrica (m)</span><input placeholder="Calculada" value={fields.bodyHeight} onChange={(event) => update('bodyHeight', event.target.value)} /></label>
            <label><span>Altura de techo (m)</span><input placeholder="Automática" value={fields.roofHeight} onChange={(event) => update('roofHeight', event.target.value)} /></label>
            <label><span>Altura de cono (m)</span><input placeholder="Automática" value={fields.hopperHeight} onChange={(event) => update('hopperHeight', event.target.value)} /></label>
            <label><span>Altura libre (m)</span><input value={fields.clearance} onChange={(event) => update('clearance', event.target.value)} /></label>
            <label><span>Descarga Ø (m)</span><input placeholder="Automática" value={fields.outletDiameter} onChange={(event) => update('outletDiameter', event.target.value)} /></label>
            <label><span>Apoyos</span><input placeholder="Automático" value={fields.supportCount} onChange={(event) => update('supportCount', event.target.value)} /></label>
            <label><span>Presupuesto</span><select value={quoteId} onChange={(event) => { setQuoteId(event.target.value); const quote = quotes.find((item) => item.id === event.target.value); if (quote?.customer?.legalName) update('customerName', quote.customer.legalName); }}><option value="">Sin asociar</option>{quotes.map((quote) => <option key={quote.id} value={quote.id}>#{quote.number} v{quote.version} · {quote.customer?.legalName || 'Cliente'}</option>)}</select></label>
            <label><span>Proyecto</span><input value={fields.projectName} onChange={(event) => update('projectName', event.target.value)} /></label>
            <label><span>Cliente</span><input value={fields.customerName} onChange={(event) => update('customerName', event.target.value)} /></label>
          </div>
          <button className="primaryButton" type="button" onClick={generate} disabled={busy === 'generate'}><DraftingCompass size={16} /> {busy === 'generate' ? 'Calculando y dibujando…' : drawing ? 'Recalcular plano' : 'Generar medidas y plano'}</button>
        </article>
        {drawing && <article className="commercialStepCard">
          <div className="stepHeading"><span>3</span><div><h3>Carátula y entrega</h3><p>Revisá los responsables antes de guardar.</p></div></div>
          <div className="commercialFormGrid">
            <label><span>Dibujó</span><input value={titleBlock.drawnBy} onChange={(event) => updateTitle('drawnBy', event.target.value)} /></label>
            <label><span>Revisó</span><input value={titleBlock.reviewedBy} onChange={(event) => updateTitle('reviewedBy', event.target.value)} /></label>
            <label><span>Aprobó</span><input value={titleBlock.approvedBy} onChange={(event) => updateTitle('approvedBy', event.target.value)} /></label>
            <label><span>Observaciones</span><input value={titleBlock.observations} onChange={(event) => updateTitle('observations', event.target.value)} /></label>
          </div>
          <div className="commercialActions">
            <button type="button" onClick={downloadSvg}><Download size={15} /> SVG</button>
            <button type="button" onClick={downloadPdf} disabled={busy === 'pdf'}><Download size={15} /> {busy === 'pdf' ? 'Preparando…' : 'PDF A3'}</button>
            <button className="primaryButton" type="button" onClick={saveDrawing} disabled={busy === 'save'}><Save size={15} /> {busy === 'save' ? 'Guardando…' : saved ? 'Crear revisión' : 'Guardar plano'}</button>
          </div>
          {selectedQuote && <p className="commercialAssociation">Se asociará al presupuesto #{selectedQuote.number} de {selectedQuote.customer?.legalName}.</p>}
          {saved && <p className="commercialSaved"><Check size={15} /> Plano {saved.drawing.drawingNumber}, revisión {saved.revision.revision}, guardado.</p>}
        </article>}
      </div>
      <div className="commercialPreviewColumn">
        <article className="commercialPreviewCard">
          <header><div><span className="eyebrow"><Eye size={14} /> Vista previa</span><h3>Hoja A3 horizontal</h3></div>{drawing && <span className="engineeringBadge warn">{drawing.result.verificationStatus}</span>}</header>
          {drawing?.svg ? <div className="a3Preview" dangerouslySetInnerHTML={{ __html: drawing.svg }} /> : <div className="engineeringEmpty"><DraftingCompass size={22} /><strong>La hoja aparecerá acá</strong><p>Generá las medidas para revisar vistas, cotas, hipótesis y carátula.</p></div>}
        </article>
        {drawing && <article className="commercialValuesCard">
          <h3>Valores del diseño</h3>
          <div className="technicalValueList">{values.map(([key, raw]) => {
            const item = raw as AnyRecord;
            return <div className="technicalValueRow" key={key}><span><strong>{fieldLabels[key] || key}</strong><small>{item.note}</small></span><b>{typeof item.value === 'number' ? Number(item.value).toLocaleString('es-AR', { maximumFractionDigits: 2 }) : String(item.value)} {item.unit}</b><em className={`origin-${String(item.origin).toLowerCase()}`}>{originLabels[item.origin] || item.origin}</em></div>;
          })}</div>
          <div className="commercialWarnings"><h4><AlertTriangle size={15} /> Advertencias</h4>{drawing.result.warnings.map((warning: string) => <p key={warning}>{warning}</p>)}</div>
        </article>}
      </div>
    </div>
  </section>;
}
