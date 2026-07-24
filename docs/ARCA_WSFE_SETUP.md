# ARCA WSFEv1: preparación segura

## Estado de la aplicación

La aplicación crea facturas internas en estado `PENDING_CONFIRMATION` y ofrece un
preflight en `GET /api/invoices/:id/arca-preflight`. La autorización fiscal todavía
está bloqueada deliberadamente: `src/services/arca.ts` valida la configuración y
falla antes de llamar a WSAA/WSFEv1. No se debe cambiar ese bloqueo ni poner
`ARCA_ENVIRONMENT=produccion` hasta terminar homologación y revisión humana.

La integración prevista es:

```text
clave privada + certificado X.509
             ↓
           WSAA (TA temporal para service=wsfe)
             ↓
          WSFEv1 (CAE por punto de venta)
             ↓
       persistencia idempotente de CAE y respuesta
```

## Responsabilidades y secretos

| Actor | Acción | Nunca debe compartir |
|---|---|---|
| Desarrollador/servidor | Genera y custodia la clave privada; genera el CSR; instala los archivos | Clave Fiscal de la empresa |
| Titular/contadora con acceso ARCA | Carga el CSR, emite el certificado, delega el Web Service y crea/confirma el punto de venta | La clave privada del servidor |
| Aplicación | Solicita TA a WSAA y consume WSFEv1 después de la aprobación | Credenciales de Clave Fiscal |

La clave privada (`private_key.key`) nunca se envía por WhatsApp, correo, Drive,
GitHub ni tickets. El CSR (`request.csr`) no es secreto y es el único archivo que
se debe enviar para solicitar el certificado.

## 1. Generar la clave y el CSR

Realizarlo en una máquina administrada por FMH, fuera del repositorio. Usar un
directorio dedicado y conservar una copia cifrada offline de la clave.

### Linux/macOS (OpenSSL)

```bash
umask 077
install -d -m 700 "$HOME/fmh-arca"
cd "$HOME/fmh-arca"
openssl genrsa -out private_key.key 2048
chmod 600 private_key.key
openssl req -new -key private_key.key -out request.csr \
  -subj "/C=AR/O=<RAZON_SOCIAL>/CN=FMH_WSFE_PROD"
chmod 644 request.csr
openssl req -in request.csr -noout -subject -text
```

### Windows PowerShell

Ejecutar OpenSSL desde una instalación confiable. El directorio no debe estar
dentro de `C:\Users\German\Desktop\facturas` ni sincronizado con la nube.

```powershell
$arcaDir = Join-Path $env:USERPROFILE 'fmh-arca'
New-Item -ItemType Directory -Force -Path $arcaDir | Out-Null
Set-Location $arcaDir
openssl genrsa -out private_key.key 2048
openssl req -new -key private_key.key -out request.csr `
  -subj "/C=AR/O=<RAZON_SOCIAL>/CN=FMH_WSFE_PROD"
openssl req -in request.csr -noout -subject -text
```

No agregar CUIT, contraseña, token o clave fiscal al `subject` salvo que el
procedimiento vigente de ARCA lo solicite expresamente. El alias (`CN` en este
ejemplo) sólo identifica el certificado.

Verificar que la clave corresponde al CSR antes de enviarlo:

```bash
openssl rsa -in private_key.key -noout -modulus | openssl sha256
openssl req -in request.csr -noout -modulus | openssl sha256
```

Los dos hashes deben coincidir. Si no coinciden, descartar el CSR y generarlo de
nuevo; nunca intentar “arreglar” la clave privada.

## 2. Homologación primero

Para pruebas usar el entorno de homologación de ARCA (WSASS), no el certificado
de producción. La contadora/titular debe solicitar el acceso al servicio de
testing con Clave Fiscal, cargar el CSR y autorizar el servicio de negocio
correspondiente. El certificado de homologación no sirve para producción.

La aplicación debe permanecer con:

```dotenv
ARCA_ENVIRONMENT=homologacion
```

La homologación debe cubrir, como mínimo:

- obtención y renovación del Ticket de Acceso (TA) de WSAA;
- `service=wsfe` y validación de reloj/expiración;
- `FECompUltimoAutorizado` por punto de venta y tipo;
- factura B y factura A con CUIT válido, incluyendo rechazos;
- reintento ante timeout sin duplicar comprobantes;
- persistencia de CAE, fecha de vencimiento, punto de venta, número y respuesta;
- respuesta ambigua: consultar el último autorizado antes de repetir;
- renovación del certificado y rotación de la clave.

## 3. Certificado y delegación

La contadora debe:

1. Cargar `request.csr` en **Administración de Certificados Digitales**.
2. Usar un alias identificable, por ejemplo `FMH_WSFE_PROD`.
3. Descargar el `.crt` emitido y devolver únicamente ese certificado.
4. En **Administrador de Relaciones de Clave Fiscal**, asociar el certificado
   al servicio de negocio **Facturación Electrónica / wsfev1** para la CUIT de FMH.
5. Confirmar que la delegación aplica al ambiente correcto (homologación o
   producción).

No hace falta ni se debe solicitar la clave fiscal de la contadora.

## 4. Punto de venta

ARCA exige un punto de venta específico para Web Services, diferente de los
usados por Controlador Fiscal, Comprobantes en Línea u otros sistemas. La
contadora debe crear o confirmar ese punto y entregar sólo el número, por
ejemplo `00005`.

Antes de autorizar una factura, validar que:

- el punto existe para la CUIT emisora;
- está habilitado para el ambiente que se está usando;
- el tipo de comprobante (A/B) corresponde a la condición fiscal del cliente;
- la numeración local coincide con `FECompUltimoAutorizado`.

## 5. Instalar en el servidor

Guardar certificados fuera del repositorio y fuera de `uploads/`, por ejemplo:

```text
/etc/fmh/arca/homologacion/fmh.crt
/etc/fmh/arca/homologacion/private_key.key
```

Permisos recomendados en Linux:

```bash
install -d -o root -g fmh -m 750 /etc/fmh/arca/homologacion
install -o root -g fmh -m 640 fmh.crt /etc/fmh/arca/homologacion/fmh.crt
install -o root -g fmh -m 640 private_key.key /etc/fmh/arca/homologacion/private_key.key
```

El proceso `fmh-app` debe pertenecer al grupo `fmh`; ningún usuario del panel
debe poder descargar los archivos. En Docker, montar sólo ese directorio como
secreto de solo lectura. No copiar claves a la imagen ni dejarlas en logs.

Variables esperadas por el repositorio (`.env`/secreto del hosting):

```dotenv
ARCA_ENVIRONMENT=homologacion
ARCA_CUIT=<CUIT_EMISORA_SIN_GUIONES>
ARCA_CERT_PATH=/etc/fmh/arca/homologacion/fmh.crt
ARCA_KEY_PATH=/etc/fmh/arca/homologacion/private_key.key
ARCA_POINT_OF_SALE=<PUNTO_DE_VENTA_WS>
```

Los valores reales sólo deben cargarse en el gestor de secretos del servidor.
No deben aparecer en commits, issues, capturas, respuestas de API ni fixtures.

## 6. Checklist antes de producción

- [ ] CSR y clave generados por FMH; hash de ambos coincide.
- [ ] Certificado emitido para el ambiente correcto y con fecha vigente.
- [ ] Certificado delegado explícitamente a `wsfev1`.
- [ ] Punto de venta Web Services creado y comunicado por la contadora.
- [ ] Pruebas de homologación registradas con request/response redactados.
- [ ] TA cacheado sólo en memoria o almacenamiento protegido y con expiración.
- [ ] Idempotencia por factura/punto de venta/número y recuperación ante timeout.
- [ ] Confirmación humana obligatoria antes de autorizar.
- [ ] Backup cifrado de clave y procedimiento de revocación/rotación.
- [ ] Monitoreo de expiración de certificado y CAE.
- [ ] `ARCA_ENVIRONMENT=produccion` habilitado sólo mediante cambio revisado.

## 7. Variables y código actual

La configuración ya existe en `src/config.ts`, `.env.example` y `render.yaml`.
El endpoint de preflight está en `src/routes/invoices.ts`. La función
`authorizeInvoiceWithArca` en `src/services/arca.ts` permanece bloqueada hasta
implementar WSAA/WSFEv1, manejo de numeración, idempotencia y homologación. Esta
guía no habilita esos llamados ni cambia el comportamiento fiscal.

## Referencias oficiales

- [ARCA — Certificados para Web Services](https://www.arca.gob.ar/ws/documentacion/certificados.asp)
- [ARCA — WSAA](https://arca.gob.ar/ws/documentacion/wsaa.asp)
- [ARCA — WSFEv1](https://arca.gob.ar/ws/documentacion/ws-factura-electronica.asp)
- [ARCA — Solicitud de autorización y punto de venta](https://www.arca.gob.ar/fe/emision-autorizacion/solicitud-autorizacion.asp)

