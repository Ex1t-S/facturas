# FMH Gestión

Aplicación de gestión para una pyme metalúrgica y agroindustrial argentina. Reúne documentos, presupuestos, remitos, facturas, clientes e inventario en una misma interfaz.

[Arquitectura](docs/ARCHITECTURE.md) · [Flujos de uso](docs/USER_FLOWS.md) · [Sistema visual](docs/UI_SYSTEM.md)

## Funcionalidades

| Área | Alcance |
| --- | --- |
| Gestión comercial | Clientes, productos, presupuestos, facturas y remitos |
| Documentos | Organización histórica, navegación por cliente y año, y vista previa |
| Generación | Presupuestos en DOCX y PDF |
| Inventario | Materiales, costos y referencias de proveedores |
| Asistencia | Búsqueda de información interna y preparación de borradores |

El cierre de remitos conserva la relación entre documentos y permite preparar comprobantes para revisión. Esa preparación no equivale a una autorización fiscal automática.

## Tecnologías

- **Backend:** Fastify y TypeScript.
- **Frontend:** React y Vite.
- **Persistencia:** PostgreSQL y Prisma.
- **Documentos:** Mammoth, PDFKit y DOCX.
- **IA opcional:** integración con OpenAI Responses API.

## Desarrollo local

```bash
git clone https://github.com/Ex1t-S/facturas.git
cd facturas
```

Preparar una base PostgreSQL de desarrollo aislada y configurar un archivo local de entorno a partir del ejemplo del repositorio. El historial incluye migraciones de una etapa anterior con SQLite; verificar el baseline antes de inicializar una base nueva.

```bash
npm install
npx prisma generate
npm run dev:backend
```

En otra terminal:

```bash
npm run dev:frontend
```

## Comprobaciones disponibles

```bash
npm run typecheck
npm test
npm run build
```

Los comandos se corresponden con los scripts del proyecto. No se ejecutaron como parte de esta edición de documentación.

## Alcance del repositorio público

Esta presentación describe las capacidades y la organización técnica del software. Las pruebas y demostraciones deben utilizar datos ficticios. La configuración específica de cada instalación, documentos comerciales reales y credenciales se administran por separado.
