import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';

export const webRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (_request, reply) => {
    const frontendIndex = path.resolve('frontend/dist/index.html');
    try {
      const html = await fs.readFile(frontendIndex, 'utf8');
      return reply.type('text/html; charset=utf-8').send(html);
    } catch {
      return reply.code(503).type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FMH Gestión</title>
    <style>
      body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: #17242d; background: #f3f6f7; }
      main { max-width: 620px; margin: 12vh auto; padding: 28px; border: 1px solid #d9e1e5; border-radius: 14px; background: white; }
      h1 { margin-top: 0; }
      code { padding: 2px 6px; border-radius: 5px; background: #eef2f4; }
    </style>
  </head>
  <body>
    <main>
      <h1>Interfaz pendiente de compilación</h1>
      <p>El servidor está activo, pero falta generar la interfaz React.</p>
      <p>Ejecutá <code>npm run build</code> y reiniciá el servicio.</p>
    </main>
  </body>
</html>`);
    }
  });
};
