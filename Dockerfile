FROM node:22-alpine

WORKDIR /app

# The lockfile pins exact versions, so a redeploy can't pull an untested library.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
