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
      // Development fallback before the React bundle has been built.
    }

    return reply.type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FMH Gestion</title>
    <link rel="stylesheet" href="/assets/styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/assets/app.js"></script>
  </body>
</html>`);
  });
};
