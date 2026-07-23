# Sistema UI/UX de FMH Gestión

## Objetivo

La interfaz debe sentirse como una herramienta operativa industrial: clara, estable, compacta y confiable. No debe parecer una colección de tarjetas genéricas ni presentar la inteligencia artificial como el producto. El producto es la gestión de FMH; la asistencia automática es una capacidad dentro de esa gestión.

## Principios

1. La tarea principal aparece primero. Cada pantalla debe tener un título concreto, una explicación breve y, como máximo, una acción primaria visible.
2. La densidad es deliberada. Tablas, formularios y métricas priorizan lectura rápida sin espacios decorativos excesivos.
3. El color comunica estado. El naranja identifica acción y pertenencia FMH; verde, amarillo y rojo se reservan para estados.
4. Las superficies son discretas. Se usan bordes finos, radios moderados y sombras mínimas. No se usan gradientes decorativos.
5. La automatización acompaña. Se habla de centro operativo, mesa técnica, preparación y revisión; siempre se conserva la trazabilidad y la decisión humana.
6. El mismo sistema cubre escritorio y móvil. En móvil la navegación pasa a un panel lateral, los controles se apilan y las tablas mantienen desplazamiento horizontal.

## Fundamentos visuales

- Fondo de aplicación: gris frío `#f2f4f5`.
- Paneles: blanco `#ffffff`.
- Navegación: azul carbón `#13202a`.
- Texto principal: `#18222b`.
- Acción FMH: naranja industrial `#c66b28`.
- Radio habitual: 4 a 7 px.
- Tipografía: Aptos, Inter o Segoe UI.
- Los números usan cifras tabulares para facilitar comparaciones.

Los tokens y las reglas consolidadas viven en `frontend/src/professional.css`. `frontend/src/styles.css` conserva compatibilidad con módulos heredados; cualquier nueva pantalla debe construirse contra la capa profesional.

## Patrones de pantalla

### Encabezado

- Antetítulo funcional de una o dos palabras.
- Título directo, sin preguntas conversacionales.
- Descripción de una línea.
- Una acción primaria a la derecha cuando corresponda.

### Métricas

- Ícono discreto, etiqueta, cifra y explicación.
- No más de cuatro métricas principales por fila.
- Un estado de atención puede usar borde y fondo cálidos, nunca animación.

### Tablas

- Cabeceras compactas en mayúsculas.
- Importes y números alineados mediante cifras tabulares.
- Acciones secundarias pequeñas dentro de la fila.
- Un único estado vacío por conjunto de datos.

### Formularios

- Etiqueta siempre visible.
- Controles de 36 px como mínimo.
- Foco de alto contraste.
- La acción principal queda al final del flujo.
- Los errores deben explicar qué falta y cómo resolverlo.

### Estados

- Verde: correcto, procesado o autorizado.
- Amarillo: pendiente o requiere revisión.
- Rojo: fallido, rechazado o cancelado.
- Gris: borrador, desconocido o neutral.

## Ingeniería y planos

Ingeniería FMH comparte navegación, tipografía, botones y estados con el resto del producto. La sección se presenta como mesa técnica e incluye:

- consultas y cálculos preliminares;
- casos guardados;
- planos orientativos e históricos;
- biblioteca de antecedentes;
- revisión humana;
- importación y validación.

Los planos orientativos deben conservar siempre su advertencia técnica y no presentarse como documentación apta para fabricación.

## Accesibilidad y responsive

- Todos los controles interactivos deben poder recorrerse con teclado.
- El foco visible no debe eliminarse.
- Los íconos sin texto necesitan nombre accesible.
- Los colores de estado deben acompañarse con texto.
- Se respeta `prefers-reduced-motion`.
- A menos de 980 px la navegación principal se convierte en panel lateral.
- A menos de 760 px las composiciones de varias columnas se apilan.
- Las tablas no deforman la pantalla: desplazan su contenido dentro del contenedor.

## Lista de control para nuevas vistas

- ¿La tarea principal se entiende en cinco segundos?
- ¿Existe una sola acción primaria?
- ¿Los estados tienen texto además de color?
- ¿Hay un único estado vacío?
- ¿Los formularios tienen etiquetas y mensajes concretos?
- ¿Funciona a 390 px sin desbordar el documento?
- ¿Se puede usar con teclado?
- ¿La automatización se presenta como capacidad y no como artificio visual?
