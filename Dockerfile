# Этап сборки (Builder)
FROM node:20-alpine AS builder
WORKDIR /app

# Копируем зависимости
COPY package.json package-lock.json* ./
# Установка зависимостей (чистая, без лок-файла Windows если он попал)
RUN npm install

# Копируем исходный код
COPY . .

# Объявляем аргументы сборки для фронтенда (Vite)
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_URL

# Устанавливаем их в окружение для процесса сборки (Vite их вшивает в JS)
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_API_URL=$VITE_API_URL

# Собираем проект
RUN npm run build

# Этап выполнения (Runner)
FROM node:20-alpine
WORKDIR /app

# Копируем только результат сборки и сервер
COPY --from=builder /app ./

# Указываем окружение
ENV NODE_ENV=production

# Открываем порт
EXPOSE 3005

# Запуск
CMD ["npm", "run", "start"]
