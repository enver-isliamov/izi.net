# Этап сборки (Builder)
FROM node:20-alpine AS builder
WORKDIR /app

# Копируем зависимости
COPY package.json package-lock.json* ./
RUN npm install

# Копируем исходный код
COPY . .

# Объявляем аргументы сборки для фронтенда (Vite)
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY

# Устанавливаем их в окружение для процесса сборки
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# Собираем проект (билд фронтенда)
RUN npm run build

# Этап выполнения (Runner)
FROM node:20-alpine
WORKDIR /app

# Копируем только необходимые файлы из билдера
COPY --from=builder /app ./

# Указываем окружение
ENV NODE_ENV=production_docker

# Открываем порт
EXPOSE 3000

# Запуск
CMD ["npm", "run", "start"]
