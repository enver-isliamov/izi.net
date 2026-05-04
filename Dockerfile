# Используем легковесный образ Node.js
FROM node:20-alpine

# Рабочая директория внутри контейнера
WORKDIR /app

# Копируем файлы зависимостей
COPY package.json package-lock.json* ./

# Устанавливаем зависимости
RUN npm install

# Копируем весь исходный код
COPY . .

# Собираем frontend (React/Vite)
RUN npm run build

# Указываем окружение для сервера
ENV NODE_ENV=production_docker

# Указываем, что контейнер будет слушать порт 3000
EXPOSE 3000

# Команда для запуска нашего full-stack сервера
CMD ["npm", "run", "start"]
