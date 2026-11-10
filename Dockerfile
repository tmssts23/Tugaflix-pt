# Imagem para o Fly.io (ou qualquer host com Docker). Sem dependências npm.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

WORKDIR /app
COPY package.json ./
COPY index.js ./
COPY lib ./lib
COPY public ./public

USER node
EXPOSE 8080
CMD ["node", "index.js"]
