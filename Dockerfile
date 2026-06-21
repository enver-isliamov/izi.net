# Этап сборки (Builder)
FROM node:20-alpine AS builder
WORKDIR /app

# Отключаем интерактивные запросы npm
ENV CI=true

# Build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Копируем только файлы зависимостей
COPY package.json package-lock.json* ./
RUN npm install

# Копируем остальной код
COPY . .

# Аргументы для Vite (запекаются в фронтенд при сборке)
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_URL

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_API_URL=$VITE_API_URL

# Сборка фронтенда
RUN npm run build

# Этап выполнения (Runner)
FROM node:20-alpine
WORKDIR /app

# Docker CLI for container restart (restart x3-ui after config changes)
RUN apk add --no-cache docker-cli

# Копируем результат сборки
COPY --from=builder /app ./

# Настройки среды
ENV NODE_ENV=production
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

EXPOSE 3005

CMD ["npm", "run", "start"]
