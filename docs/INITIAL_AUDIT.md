# Auditoría inicial de la plataforma estructural FMH

Fecha de corte: 2026-07-23  
Alcance: Fase 0 del prompt maestro de cálculo y generación de planos estructurales  
Repositorio inspeccionado: `C:\Users\German\Desktop\facturas`

## Resumen ejecutivo

FMH Gestión es una aplicación monolítica modular orientada a la operación de una pyme metalúrgica. Ya resuelve clientes, presupuestos, remitos, facturas internas, documentos, inventario, proveedores, WhatsApp y una primera mesa de ingeniería. Esa base es valiosa y debe conservarse.

La capacidad de ingeniería actual no es todavía una plataforma de análisis estructural. Hoy permite:

- conversar sobre equipos y estructuras;
- conservar datos, supuestos, mensajes y llamadas de herramientas;
- consultar antecedentes, reglamentos candidatos, planos históricos y secciones;
- ejecutar conversiones y cálculos deterministas simples;
- preparar cómputos, barras, cortes, peso y costo cuando existen datos verificables;
- generar un SVG/PDF orientativo para silos, tolvas y estructuras simples.

No existen aún:

- un modelo canónico versionado de nodos, barras, losas, apoyos, materiales, secciones, cargas y combinaciones;
- un motor de rigidez o integración con un solver estructural;
- resultados de reacciones, esfuerzos y deformaciones asociados de forma inmutable a una versión;
- verificaciones normativas de hormigón;
- un editor estructural 2D/3D;
- una representación intermedia de planos;
- exportación estructural JSON, DXF o IFC;
- memoria de cálculo generada exclusivamente desde resultados persistidos;
- ejecución aislada, cancelable y observable de análisis.

La recomendación es evolucionar el monolito existente con límites de dominio claros. No se justifica sustituir React, Fastify, TypeScript, Prisma ni PostgreSQL para el primer MVP. Python y motores externos deben incorporarse detrás de un adaptador cuando el primer caso analítico TypeScript esté verificado.

## Cómo leer este documento

Este informe separa dos categorías:

- **Hecho local verificado:** surge del código, esquema, base conectada o comandos ejecutados en este repositorio.
- **Recomendación:** es una decisión propuesta para la arquitectura futura. Cuando depende de una tecnología o normativa externa, incluye una fuente oficial o primaria.

Las fuentes externas no demuestran que una integración ya exista. Sirven para evaluar alcance, compatibilidad y riesgos antes de implementarla.

Las decisiones confirmadas de normativa, unidades, responsable, motor inicial, planos y conocimiento están registradas en [`DECISIONS/0001-structural-mvp-and-engineering-knowledge.md`](DECISIONS/0001-structural-mvp-and-engineering-knowledge.md).

## Puntuación actual

**Puntuación global frente al MVP estructural solicitado: 4/10.**

Desglose orientativo:

| Dimensión | Puntaje | Evaluación |
|---|---:|---|
| Base comercial y documental | 7/10 | Operativa, con flujos útiles y trazabilidad parcial |
| Backend y contratos | 6/10 | Modular por rutas/servicios, Zod y TypeScript estricto |
| Base de datos | 5/10 | Modelo rico, pero migraciones no reproducibles desde cero y exceso de JSON |
| Seguridad de instalación privada | 6/10 | Controles importantes; autenticación multiusuario pendiente |
| Ingeniería preliminar | 5/10 | Buena asistencia, biblioteca, cómputos y planos orientativos |
| Análisis estructural verificable | 1/10 | No hay modelo analítico ni solver |
| Editor y visualización estructural | 1/10 | No hay lienzo 2D/3D ni resultados sobre el modelo |
| Planos y memoria de cálculo | 3/10 | Hay plantilla orientativa; faltan documentos derivados de análisis |
| Calidad automatizada | 6/10 | Typecheck y cobertura de servicios; falta lint, E2E y hay una regresión |
| Operación y observabilidad | 4/10 | Logs y trazas parciales; sin cola durable ni aislamiento de cálculo |

La puntuación no cuestiona el valor del sistema comercial. Mide específicamente la distancia respecto de una plataforma estructural trazable y verificable.

## Evidencia ejecutada

Los comandos se ejecutaron sobre el código real. No se modificaron datos ni código funcional durante esta auditoría.

| Comando | Resultado |
|---|---|
| `npm run typecheck` | Aprobado: backend y frontend sin errores |
| `npm test` | Aprobado: 100 pruebas aprobadas y 1 omitida |
| `npm run build` | Aprobado después de detener únicamente el servidor local que mantenía cargado el binario Prisma |
| `npm run build:frontend` | Aprobado: 1767 módulos transformados |
| `npm run lint` | No existe script de lint |
| `npx prisma validate` | Aprobado |
| `npx prisma migrate status` | La base PostgreSQL conectada informa 14 migraciones aplicadas y esquema actualizado |
| `npm audit --omit=dev` | 0 vulnerabilidades conocidas |

La regresión del flujo de plano con geometría incompleta fue corregida: el contrato vuelve a exigir una identificación explícita de los valores ilustrativos. El build completo también quedó validado. El bloqueo anterior era operacional: Windows no podía reemplazar el binario Prisma mientras el servidor lo tenía cargado. El pipeline CI igualmente debe construir en un directorio limpio y sin servidor activo.

## Stack real

### Aplicación

| Capa | Tecnología real | Archivos principales |
|---|---|---|
| Frontend | React 19, TypeScript, Vite 8, Lucide | `frontend/src/App.tsx`, `frontend/src/features/engineering/EngineeringPage.tsx` |
| Estilos | CSS propio, sistema visual FMH | `frontend/src/styles.css`, `frontend/src/professional.css` |
| Backend | Node.js, Fastify 5, TypeScript ESM | `src/server.ts`, `src/routes/` |
| Validación | Zod 4 | rutas y esquemas de servicios |
| Persistencia | Prisma 6 y PostgreSQL | `prisma/schema.prisma`, `src/db.ts` |
| Persistencia auxiliar | Esquema Prisma SQLite histórico | `prisma/schema.sqlite.prisma` |
| Pruebas | Vitest 4 | 15 archivos `*.test.ts` |
| Documentos | `docx`, PDFKit, Mammoth, LibreOffice opcional | `src/services/fmh*Document.ts`, `src/services/documentPreview.ts` |
| Archivos | Sistema de archivos privado y rutas controladas | `src/services/documentStorage.ts` |
| IA | OpenAI Responses API opcional y fallback local | `src/services/assistant.ts`, `src/services/engineering/` |
| WhatsApp | Meta Cloud API | `src/routes/whatsapp.ts`, `src/services/whatsapp.ts` |
| Despliegue | Docker, Render y PostgreSQL Neon | `Dockerfile`, `render.yaml` |

No están instalados Next.js, Tailwind, shadcn/ui, Zustand, TanStack Query, React Hook Form, Three.js, Python, FastAPI, Redis, Celery, OpenSeesPy, PyNite, IfcOpenShell ni ezdxf. Agregarlos todos de inmediato aumentaría el riesgo sin completar un flujo vertical.

### Configuración

El proyecto dispone de `.env.example`, Dockerfile y blueprint de Render. La configuración cubre PostgreSQL, documentos, OpenAI, WhatsApp, seguridad Basic, proveedores y ARCA. La instancia local tiene `.env`; durante esta auditoría sólo se inspeccionaron los nombres de variables, no sus valores.

## Arquitectura actual

```text
React/Vite
  ├─ operación comercial
  ├─ documentos e inventario
  ├─ WhatsApp
  └─ Ingeniería FMH
        ↓ HTTP / JSON
Fastify
  ├─ rutas API y validación Zod
  ├─ servicios comerciales/documentales
  ├─ orquestadores de asistentes
  ├─ cálculos deterministas simples
  └─ render SVG/PDF preliminar
        ↓
Prisma
  ├─ PostgreSQL
  └─ archivos privados en disco

Integraciones opcionales:
  ├─ OpenAI Responses API
  ├─ Meta Cloud API
  ├─ fuentes públicas de proveedores
  └─ ARCA (deliberadamente bloqueada)
```

Fastify sirve tanto la API como el frontend compilado. Es un monolito modular: una decisión adecuada para el tamaño actual, siempre que el nuevo dominio estructural no quede mezclado con el asistente o con las rutas comerciales.

## Funcionalidades existentes

### Operación comercial

- empresas, clientes, productos, materiales y proveedores;
- presupuestos y generación DOCX/PDF;
- remitos, selección mensual, cierre por cliente y trazabilidad hacia presupuesto/factura;
- facturas internas en borrador; ARCA no autorizado;
- inventario, precios de proveedores y costos;
- documentos históricos, extracción, preview, revisión y asociación;
- auditoría de operaciones críticas.

### WhatsApp

- webhook firmado;
- allowlist configurable;
- conversaciones y mensajes persistidos;
- deduplicación por identificador del proveedor;
- texto, audio y documentos acotados;
- borradores conversacionales, preview, confirmación y cancelación;
- bandeja operativa y reproceso.

### Ingeniería

- conversaciones persistentes;
- estado técnico en JSON con datos confirmados, hipótesis y faltantes;
- registro de modelo, proveedor, latencia, error, tokens y costo estimado;
- llamadas de herramientas auditables;
- biblioteca documental y fuentes;
- reglamentos candidatos y referencias;
- catálogo de secciones con procedencia y revisión;
- casos guardados;
- revisión humana reanudable;
- cálculos de carga vertical, carga nominal por apoyo, tensión axial, esbeltez y Euler de referencia;
- geometría, unidades, materiales, BOM, compra y optimización simple de cortes;
- ingestión de planos históricos PDF;
- plano orientativo SVG/PDF con cajetín FMH y advertencia de no fabricación.

## Base de datos y migraciones

### Estado observado

La base configurada es PostgreSQL y Prisma la considera actualizada con 14 migraciones. En la consulta de diagnóstico de sólo lectura se observaron, como instantánea:

| Entidad | Filas |
|---|---:|
| Empresas | 1 |
| Usuarios | 0 |
| Clientes | 20 |
| Presupuestos | 7 |
| Remitos | 1 |
| Facturas | 0 |
| Conversaciones WhatsApp | 2 |
| Conversaciones de ingeniería | 4 |
| Mensajes de ingeniería | 20 |
| Casos de ingeniería | 0 |
| Cálculos de ingeniería | 2 |
| Planos históricos | 23 |

Estos conteos son una fotografía y pueden cambiar. No se inspeccionó contenido comercial ni conversaciones.

### Hallazgos

1. `prisma/schema.prisma` es PostgreSQL y válido.
2. `prisma/schema.sqlite.prisma` conserva el modo histórico/auxiliar.
3. `migration_lock.toml` declara PostgreSQL.
4. Las tres primeras migraciones contienen DDL típico de SQLite, por ejemplo claves `TEXT NOT NULL PRIMARY KEY`.
5. Las migraciones posteriores usan sintaxis PostgreSQL como `CREATE TYPE`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` y restricciones nombradas.
6. La base conectada conoce las 14 migraciones, pero eso no demuestra que una base PostgreSQL vacía pueda reproducirse ejecutando el directorio histórico.
7. No existe todavía una prueba automatizada de migración desde cero ni restauración.
8. Muchos agregados de ingeniería persisten estructuras completas en columnas `String` con JSON. Esto facilitó prototipar, pero no ofrece integridad referencial ni consultas seguras para un modelo estructural.

### Modelos de ingeniería actuales

Existen `StructuralSection`, `EngineeringProject`, `EngineeringCalculation`, `EngineeringConversation`, `EngineeringMessage`, `EngineeringToolCall`, `EngineeringCase`, fuentes, benchmarks, revisiones y planos.

No existen entidades canónicas equivalentes a:

- `StructuralProjectVersion`;
- `UnitSystem`;
- `Level` y `GridAxis`;
- `StructuralNode`;
- `Material`;
- `Section` normalizada;
- `Member`;
- `Slab` o `Panel`;
- `Foundation`;
- `Support`;
- `LoadCase`, `NodalLoad`, `MemberLoad`, `SurfaceLoad`;
- `LoadCombination`;
- `ModelValidationIssue`;
- `AnalysisRun`;
- `NodeResult`, `MemberResult`, `ReactionResult`;
- `DesignCheck`;
- `DrawingDocument`, `DrawingSheet` y entidades de dibujo.

## Seguridad

### Controles existentes

- Helmet;
- CORS explícito en producción;
- rate limiting;
- límite global de body y límites de multipart;
- redacción de secretos en logs;
- Basic Auth obligatorio en producción;
- comparación temporalmente segura de credenciales;
- validación de firma de WhatsApp;
- allowlist de remitentes en producción;
- validación Zod;
- archivos privados entregados mediante endpoints;
- restricciones de raíz para importaciones;
- sanitización y límites de medios;
- errores de producción sin stack interno;
- `companyId` requerido y comprobaciones de pertenencia en recursos críticos;
- ARCA bloqueada deliberadamente.

### Riesgos pendientes

- El modelo `User` existe, pero no hay usuarios activos en la base ni sesiones/membresías: Basic Auth identifica a una instalación, no a cada responsable.
- El cliente envía `companyId`; sin identidad y membresía no existe una autorización multiempresa completa.
- Las acciones de ingeniería pueden registrar `userId` o revisor como texto opcional, pero no existe una identidad fuerte que firme la revisión.
- Los cálculos todavía se ejecutan en el proceso web; no hay aislamiento de CPU, memoria o tiempo.
- Las ingestas en segundo plano usan tareas locales; no hay cola durable, lease, reintentos ni dead-letter.
- No existe política documentada y probada de backup/restauración de PostgreSQL más archivos.
- Falta análisis SAST/lint y una política CI obligatoria.
- El endpoint de IA debe conservar herramientas tipadas y nunca admitir ejecución libre, `eval` o shell derivado del texto.

## Estado del frontend y UX

### Fortalezas

- navegación separada entre operación, gestión y herramientas;
- sistema visual industrial documentado;
- flujo de cierre mensual de remitos;
- bandeja de WhatsApp;
- mesa de ingeniería con conversaciones, casos, planos, biblioteca, revisión e importación;
- advertencias visibles en planos preliminares;
- estilos responsive y foco accesible;
- acciones de revisión humana.

### Problemas frente al editor estructural solicitado

- `frontend/src/App.tsx` sigue siendo grande y concentra pantallas heterogéneas;
- `professional.css` también es muy extenso y convive con estilos heredados;
- hay implementaciones de ingeniería heredadas dentro de `App.tsx` además de `EngineeringPage.tsx`, lo que aumenta duplicación y riesgo;
- la capa de API usa `fetch` directo y `AnyRecord`, sin contratos compartidos;
- no hay manejo normalizado de caché, invalidación ni estados remotos;
- no hay creación de proyecto estructural, selección de versión, normativa o unidades;
- no hay navegador por niveles/categorías;
- no existe lienzo 2D, grilla, snapping, selección, propiedades contextuales, undo/redo ni atajos;
- no hay visor 3D;
- validaciones y resultados no se ubican sobre la geometría;
- no existen panel inferior de análisis, comparación de versiones ni estado de resultados obsoletos;
- el flujo “plano de silo de 200 t” produce una plantilla ilustrativa con dimensiones asumidas, no un modelo estructural ni un plano derivado de análisis.

## Evaluación del flujo “plano de un silo de 200 t”

### Comportamiento actual

1. El usuario pide un plano orientativo de silo de 200 t.
2. El clasificador reconoce la intención `PRELIMINARY_DRAWING`.
3. Si faltan geometrías, la respuesta propone hipótesis como diámetro, altura, cono, altura libre y apoyos.
4. La UI ofrece “Generar plano”.
5. `POST /api/engineering/drawing` renderiza un SVG/PDF paramétrico.
6. El documento muestra capacidad, vistas generales, supuestos y “NO UTILIZAR PARA FABRICAR”.

### Qué está bien

- no se presenta como plano final;
- las hipótesis son visibles;
- no depende de generación de imagen para la geometría;
- existe una plantilla FMH;
- los antecedentes y fuentes pueden consultarse por separado;
- la generación es determinista a partir de un esquema validado.

### Qué falta

- separar capacidad de almacenamiento, geometría de proceso y modelo resistente;
- confirmar densidad aparente del producto, geometría de tolva, altura total y proceso de descarga;
- ubicación, viento, sismo, temperatura y acciones de operación;
- material, espesores, rigidizadores, apoyos, arriostramiento, uniones, anclajes y fundaciones;
- normativa aplicable validada por un responsable;
- modelo canónico versionado;
- análisis de cascarón o una metodología explícita aceptada;
- resultados persistidos y verificaciones;
- planta, elevación, cortes y detalles derivados del modelo aprobado;
- revisión y firma profesional.

La búsqueda web puede ayudar a encontrar normativa oficial, fichas de producto o antecedentes públicos, pero no debe “aprender” dimensiones de fabricación sin procedencia. Toda fuente debe guardar URL, dominio, fecha de consulta, versión, hash cuando sea posible, jurisdicción, estado y revisor. La geometría extraída debe entrar como propuesta pendiente de confirmación.

## Calidad y pruebas

### Cobertura actual

Hay 15 archivos de test con alrededor de 100 declaraciones. Cubren:

- dinero y redondeo;
- documentos FMH y plantillas;
- conversaciones comerciales;
- seguridad;
- WhatsApp;
- cierre mensual;
- dominio de ingeniería;
- conversación de ingeniería;
- flujo de plano preliminar;
- biblioteca técnica y revisión.

### Brechas

- no hay ESLint configurado;
- no hay pruebas de componentes frontend;
- no hay E2E real de navegador;
- no hay test de una base PostgreSQL vacía aplicando migraciones;
- no hay test de backup/restauración;
- no hay regresiones numéricas de vigas, voladizos, columnas o pórticos;
- no hay tolerancias numéricas institucionalizadas;
- no hay pruebas de inestabilidad, convergencia o cancelación de análisis;
- no hay fixtures estructurales canónicos;
- no hay pruebas de exportación JSON/DXF/IFC;
- no hay prueba de memoria de cálculo;
- el proceso local de build requiere que ningún servidor mantenga bloqueado el binario generado; CI debe garantizar ese aislamiento.

## Principales fortalezas

1. Stack TypeScript coherente y estricto.
2. Backend organizado en rutas, servicios y dominio.
3. PostgreSQL y Prisma ya operativos.
4. Validación Zod extendida.
5. Flujos comerciales con valor real.
6. Buen punto de partida de documentos y generación PDF/DOCX.
7. Conversaciones y tool calls de ingeniería persistidas.
8. Cálculos simples deterministas separados del LLM.
9. Biblioteca técnica con procedencia, estado y revisión.
10. Advertencias de seguridad en los planos orientativos.
11. Tests de negocio significativos.
12. Controles de seguridad razonables para una instalación privada.

## Principales defectos

1. No existe el núcleo de dominio estructural solicitado.
2. No existe un motor de análisis.
3. `EngineeringCalculation` no versiona entrada completa, motor, hash, convergencia ni resultados normalizados.
4. No hay inmutabilidad ni invalidación de resultados cuando cambia el modelo.
5. No hay editor estructural.
6. No hay verificaciones normativas.
7. No hay representación intermedia de dibujo.
8. No hay memoria trazable.
9. No hay exportadores estructurales.
10. El historial de migraciones no es reproducible con confianza desde una base PostgreSQL vacía.
11. Identidad y permisos son insuficientes para revisión profesional multiusuario.
12. No hay cola ni aislamiento de cálculos.
13. Exceso de JSON sin esquema relacional en entidades técnicas.
14. Duplicación y tamaño elevado en frontend/asistentes.
15. La suite no está completamente verde y falta lint.

## Riesgos técnicos

| Riesgo | Severidad | Motivo |
|---|---|---|
| Baseline PostgreSQL no reproducible | P0 | Impide restauración/despliegue confiable |
| Resultados sin versión/hash | P0 | No se puede demostrar qué modelo produjo un resultado |
| Unidades no canónicas en todo el pipeline | P0 | Puede producir errores silenciosos de escala |
| LLM presentado cerca de cálculos | P0 | Riesgo de confundir explicación con resultado válido |
| Cálculo en proceso web | P0 | Puede bloquear, agotar recursos o perder estado |
| Falta de identidad del revisor | P1 | Revisión y aprobación no atribuibles |
| JSON técnico sin integridad | P1 | Referencias huérfanas y cambios difíciles de validar |
| Monolitos frontend/asistente | P1 | Regresiones y dificultad de mantenimiento |
| Sin E2E ni CI limpio | P1 | Los flujos completos no están garantizados |
| Dependencia del filesystem local | P1 | Riesgo de pérdida de documentos en despliegues efímeros |

## Riesgos estructurales

1. Confundir carga nominal por apoyo con diseño de patas, arriostramientos o fundaciones.
2. Usar Euler ideal como verificación normativa.
3. Omitir viento, sismo, excentricidades, presión de almacenamiento, descarga y efectos térmicos.
4. Utilizar secciones candidatas no verificadas.
5. Asumir geometría de silo sólo desde capacidad.
6. Presentar un esquema gráfico como plano estructural.
7. Generar cifras narrativas no persistidas.
8. No declarar normativa, unidades, hipótesis, motor y versión en cada salida.
9. No detectar inestabilidad o conectividad inválida.
10. No bloquear documentación cuando el análisis está ausente, fallido u obsoleto.

## Arquitectura objetivo incremental

La arquitectura debe conservar el despliegue monolítico al inicio y separar responsabilidades mediante módulos internos:

```text
React/Vite
  ├─ Project Workspace
  ├─ Editor 2D
  ├─ Propiedades
  ├─ Validación
  ├─ Resultados
  ├─ Planos/documentos
  └─ Asistente
          ↓ contratos versionados
Fastify
  ├─ Project Service
  ├─ Structural Model Service
  ├─ Geometry Service
  ├─ Validation Service
  ├─ Analysis Service
  │     └─ Engine Adapter
  ├─ Design Service
  ├─ Drawing Service
  ├─ Report Service
  ├─ BIM/Import Service
  └─ AI Orchestrator
          ↓
PostgreSQL + almacenamiento privado
          ↓
Worker aislado
  ├─ motor analítico TypeScript inicial
  └─ adaptador Python/OpenSeesPy o PyNite posterior
```

### Decisiones recomendadas

- Mantener React/Vite; no migrar a Next.js durante el MVP.
- Mantener Fastify/TypeScript como API y orquestador.
- Mantener PostgreSQL/Prisma para metadatos, modelos y resultados normalizados.
- Definir un modelo canónico independiente de cualquier solver.
- Usar el sistema interno confirmado: longitud en `m`, fuerza en `kN` y tensión/módulo en `MPa`. Las unidades derivadas y conversiones se formalizarán junto al modelo de dominio.
- Crear versiones inmutables publicadas; la edición ocurre sobre un borrador y cada análisis referencia una versión congelada.
- Empezar con un motor analítico propio para vigas conocidas y luego un pequeño pórtico plano.
- Incorporar Python sólo detrás de `StructuralAnalysisEngine`.
- Ejecutar análisis en un proceso separado con timeout y límites; Redis puede esperar hasta que exista necesidad real de múltiples workers, pero la interfaz de jobs debe diseñarse desde el inicio.
- No hacer que el agente escriba tablas directamente. Debe llamar herramientas tipadas que atraviesen validación, permisos y auditoría.
- Crear un documento intermedio de dibujo antes de SVG, PDF o DXF.
- Tratar IFC como fase posterior al flujo 2D completo.

### Decisiones reforzadas con fuentes primarias

#### Motor de análisis

OpenSees es un framework de simulación estructural y geotécnica con comandos de modelo, análisis y resultados; OpenSeesPy expone ese dominio desde Python. Eso lo convierte en un candidato razonable para una fase posterior, no en una razón para acoplar el modelo canónico al solver. La documentación oficial muestra que el dominio del motor agrega nodos, elementos, restricciones y patrones de carga, justamente los conceptos que el adaptador deberá traducir desde FMH:

- [OpenSees — documentación oficial](https://opensees.github.io/OpenSeesDocumentation/)
- [OpenSeesPy — comandos de modelo](https://openseespydoc.readthedocs.io/en/latest/src/modelcmds.html)
- [OpenSeesPy — comandos de análisis](https://openseespydoc.readthedocs.io/en/stable/src/analysis.html)

**Gate obligatorio:** la documentación de OpenSeesPy declara que la redistribución comercial, incluida una aplicación o servicio cloud que lo incorpore, requiere revisar una licencia específica. Antes de incluirlo en FMH se necesita una decisión legal/comercial documentada:

- [OpenSeesPy — documentación y condición de redistribución](https://openseespydoc.readthedocs.io/en/latest/)

Por ese motivo, el primer motor seguirá siendo analítico, pequeño y verificable dentro del repositorio. OpenSeesPy, PyNite u otro motor no se seleccionarán hasta completar una matriz de capacidades, licencia, mantenimiento, plataformas, convergencia, serialización y casos de regresión.

#### Normativa argentina

La fuente normativa primaria debe ser INTI-CIRSOC, no resúmenes web ni respuestas del modelo. El catálogo oficial vigente lista, entre otros, CIRSOC 101-25 para cargas permanentes/sobrecargas, CIRSOC 102-25 para viento, CIRSOC 201-25 para hormigón y CIRSOC 301-2018 para acero:

- [INTI-CIRSOC — reglamentos oficiales](https://www.inti.gob.ar/areas/serviciosindustriales/construcciones-e-infraestructura/cirsoc/reglamentos)

La aplicación no debe asumir que “la edición más nueva” es automáticamente la aplicable a cada obra. Debe guardar código, edición, jurisdicción, estado legal, fecha de consulta, documento oficial y decisión del profesional responsable. Una actualización normativa crea una nueva configuración/versionado; nunca modifica retrospectivamente análisis históricos.

#### IFC y BIM

buildingSMART publica el esquema y documentación oficial IFC. IfcOpenShell permite leer, editar y escribir IFC, además de procesar geometría. Estas capacidades justifican mantener IFC en una fase posterior, pero no eliminan la necesidad de mapear y revisar por separado el modelo físico y el analítico:

- [buildingSMART — especificación IFC 4.3](https://ifc43-docs.standards.buildingsmart.org/)
- [IfcOpenShell — API oficial](https://docs.ifcopenshell.org/autoapi/ifcopenshell/index.html)
- [IfcOpenShell — procesamiento de geometría](https://docs.ifcopenshell.org/ifcopenshell-python/geometry_processing.html)

El `GlobalId` IFC debe preservarse como referencia externa, no reemplazar los IDs/versiones internos. La importación debe registrar entidades no reconocidas, transformaciones y unidades, y exigir revisión antes de producir un modelo analizable.

#### DXF y documentación

ezdxf soporta creación, lectura, modificación y escritura de DXF, incluyendo versiones habituales, capas, layouts y recursos de dibujo. Es un candidato concreto para el exportador posterior:

- [ezdxf — documentación oficial](https://ezdxf.readthedocs.io/en/stable/)
- [ezdxf — documento, modelspace y paperspace](https://ezdxf.readthedocs.io/en/stable/drawing/drawing.html)

La dependencia no debe entrar antes de crear `DrawingDocument`. El adaptador DXF consumirá esa representación intermedia; no deberá leer directamente nodos y miembros del dominio.

### Matriz de decisiones de tecnología

| Decisión | Para el MVP | Condición de avance |
|---|---|---|
| React/Vite | Conservar | Modularizar por feature y eliminar `AnyRecord` en contratos nuevos |
| Fastify/TypeScript | Conservar | Rutas delgadas y servicios de dominio aislados |
| Prisma/PostgreSQL | Conservar | Baseline reproducible y entidades estructurales relacionales |
| Motor analítico TypeScript | Implementar primero | Soluciones cerradas, equilibrio y tolerancias aprobadas |
| OpenSeesPy | Evaluar después | Licencia comercial, worker Python y benchmarks aprobados |
| PyNite/u otro solver | Evaluar, no adoptar aún | Matriz equivalente de licencia/capacidades/mantenimiento |
| Redis | No obligatorio al inicio | Incorporar ante múltiples workers o carga que PostgreSQL no resuelva |
| ezdxf | Fase de documentación | `DrawingDocument` estable y golden files |
| IfcOpenShell | Fase BIM | Importación JSON/CSV y modelo 2D completos |
| Three.js/R3F | Opcional P2 | Sólo si la vista 3D agrega valor después del editor SVG 2D |

## Alcance concreto del MVP

### MVP 1.0

Un usuario autorizado podrá:

1. crear un proyecto estructural;
2. definir normativa como metadato y sistema de unidades;
3. crear una versión de trabajo;
4. definir niveles y grilla;
5. crear nodos, vigas, columnas, apoyos y elementos lineales genéricos;
6. definir materiales y secciones;
7. registrar losa unidireccional y fundación aislada simple;
8. asignar cargas puntuales, distribuidas y superficiales;
9. crear casos y combinaciones;
10. validar geometría, referencias, unidades y estabilidad básica;
11. analizar vigas y un pórtico plano pequeño con un motor determinista;
12. visualizar reacciones, esfuerzos y deformada;
13. ejecutar verificaciones básicas claramente delimitadas;
14. generar memoria desde resultados persistidos;
15. generar planta estructural preliminar;
16. exportar JSON y DXF/PDF;
17. consultar resultados existentes mediante el asistente;
18. conservar revisión, advertencias e historial.

El primer motor entregable dentro de este alcance se limita a vigas simples y un pórtico plano 2D pequeño. El resto del MVP se incorpora después de validar esa rebanada vertical.

### Decisiones ya confirmadas

- normativa base: CIRSOC Argentina;
- unidades internas: `m`, `kN`, `MPa`;
- responsable: Ingeniero Civil German Arroyo;
- identificador profesional almacenado como string: `03136/5`;
- motor analítico propio antes de evaluar OpenSeesPy;
- todos los planos son preliminares y no aptos para fabricación hasta revisión;
- backup y restore obligatorios antes de corregir migraciones;
- planos y documentos como RAG/biblioteca trazable, no fine-tuning.

### Fuera del MVP

- edificios completos;
- cascarones y análisis detallado de silos;
- reconocimiento automático de PDF/imágenes como modelo calculable;
- diseño automático completo;
- armaduras de producción y planillas de doblado;
- optimización generativa;
- edición colaborativa en tiempo real;
- BIM bidireccional completo;
- firma digital profesional;
- múltiples motores simultáneos.

El silo de 200 t seguirá siendo, durante este MVP, un flujo de levantamiento de datos y esquema preliminar. No debe convertirse en el caso de validación del solver de pórticos sin definir antes una metodología específica para silos.

## Primer bloque de implementación recomendado

**Bloque 1: columna vertebral segura del modelo estructural.**

Objetivo: crear un proyecto versionado, persistir un pórtico pequeño, validarlo y producir un hash reproducible, sin ejecutar todavía un análisis que pueda confundirse con diseño final.

Archivos futuros principales:

```text
src/domain/structural/
  units.ts
  model.ts
  geometry.ts
  validation.ts
  hashing.ts
src/services/structural/
  projectService.ts
  modelService.ts
  validationService.ts
src/routes/
  structuralProjects.ts
  structuralModels.ts
prisma/schema.prisma
frontend/src/features/structural/
  StructuralWorkspace.tsx
  ProjectSetup.tsx
  ModelTree.tsx
docs/DECISIONS/
tests/fixtures/structural/
```

Antes de modificar el esquema se necesita un baseline PostgreSQL limpio.

### Tests necesarios para el bloque

- conversiones entre mm/cm/m, N/kN, kg/t y Pa/kPa/MPa;
- rechazo de conversiones incompatibles;
- serialización estable y hash determinista;
- nodos duplicados dentro de tolerancia;
- elemento de longitud cero;
- referencias huérfanas;
- modelo sin apoyos;
- carga sin caso;
- combinación duplicada;
- aislamiento por empresa/proyecto;
- publicación de una versión inmutable;
- invalidación de resultados al crear una versión nueva;
- migración desde PostgreSQL vacío;
- contrato API crear/leer/validar.

### Criterios de aceptación del bloque

1. Una base PostgreSQL vacía puede instalarse automáticamente.
2. Un proyecto y versión se crean con identidad de empresa y usuario.
3. Todas las magnitudes se normalizan al sistema interno documentado.
4. El modelo canónico se valida mediante esquemas estrictos.
5. No pueden persistirse referencias huérfanas.
6. La misma versión produce siempre el mismo hash.
7. Una versión publicada no puede modificarse.
8. Las validaciones devuelven código, severidad, elemento, explicación y solución.
9. Typecheck, lint, tests y build pasan en CI limpio.
10. La UI no presenta ningún resultado de análisis porque el motor aún no forma parte de este bloque.

## Lista priorizada

### P0 — Críticas

- mantener la suite verde y el contrato de seguridad del plano incompleto;
- realizar backup y restore verificado antes de tocar migraciones;
- crear y probar un baseline PostgreSQL reproducible;
- definir sistema interno de unidades y conversiones;
- definir frontera explícita entre orientación, cálculo y verificación;
- crear modelo canónico y versionado inmutable;
- asegurar identidad/permisos antes de aprobación profesional;
- diseñar ejecución aislada y registro inmutable de análisis;
- definir backup/restauración de base y archivos.
- remapear/restaurar copias operativas de los 23 planos antes de prometer referencias completas.

### P1 — Altas

- validación geométrica/estructural con códigos de error;
- primer motor analítico con fixtures conocidos;
- pórtico plano pequeño y resultados normalizados;
- editor 2D mínimo;
- resultados obsoletos al cambiar el modelo;
- memoria y planta derivadas sólo de resultados persistidos;
- contratos compartidos frontend/backend;
- E2E del flujo vertical;
- modularizar frontend e ingeniería.

### P2 — Medias

- losas unidireccionales y fundaciones simples;
- verificaciones de hormigón acotadas a normativa elegida;
- DXF mediante documento intermedio;
- vista 3D básica;
- comparación de versiones;
- cola durable y métricas operativas;
- importación CSV/JSON estructural.

### P3 — Futuras

- IFC con IfcOpenShell;
- referencia DXF y conversión manual de capas;
- OCR/visión con revisión obligatoria;
- análisis detallado de silos;
- múltiples motores;
- diseño generativo y optimización;
- edición colaborativa;
- BIM bidireccional.

## Conclusión

El repositorio tiene una base comercial y documental que conviene reutilizar, además de una primera disciplina correcta: los cálculos simples están separados del modelo de lenguaje y los planos se rotulan como preliminares. El siguiente paso no es agregar más conversación ni más plantillas. Es construir la columna vertebral del dominio estructural: unidades, modelo canónico, versiones, validación, hash, análisis inmutable y regresiones numéricas.

No debe iniciarse una reescritura general. La evolución incremental sobre Fastify, React y PostgreSQL es técnicamente suficiente para alcanzar el primer flujo verificable.

## Fuentes externas consultadas

Estas fuentes sustentan recomendaciones futuras; no son evidencia de funcionalidad implementada:

- [INTI-CIRSOC — reglamentos oficiales](https://www.inti.gob.ar/areas/serviciosindustriales/construcciones-e-infraestructura/cirsoc/reglamentos)
- [OpenSees — documentación oficial](https://opensees.github.io/OpenSeesDocumentation/)
- [OpenSeesPy — documentación oficial](https://openseespydoc.readthedocs.io/en/latest/)
- [buildingSMART — IFC 4.3](https://ifc43-docs.standards.buildingsmart.org/)
- [IfcOpenShell — documentación oficial](https://docs.ifcopenshell.org/)
- [ezdxf — documentación oficial](https://ezdxf.readthedocs.io/en/stable/)
