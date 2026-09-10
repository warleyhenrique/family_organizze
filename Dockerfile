FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /data/uploads && chown -R node:node /app /data
ENV PORT=3000 DATA_DIR=/data
USER node
EXPOSE 3000
CMD ["npm", "start"]
