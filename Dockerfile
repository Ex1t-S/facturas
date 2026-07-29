FROM node:22-bookworm-slim

ENV NODE_ENV=production

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates libreoffice-writer fonts-dejavu \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev
RUN npm install --global @openai/codex@0.146.0

COPY . .
RUN npx prisma generate \
  && npm run build \
  && npm prune --omit=dev

EXPOSE 3000
CMD ["npm", "start"]
