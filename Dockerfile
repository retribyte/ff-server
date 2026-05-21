FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci
RUN npx prisma generate

FROM base AS dev
EXPOSE 3000
CMD ["npx", "tsx", "src/server.ts"]

FROM base AS build
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:22-alpine AS prod
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev
RUN npx prisma generate
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
