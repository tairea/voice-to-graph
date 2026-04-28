FROM node:20-alpine
WORKDIR /opt/gun-relay
COPY package.json ./
RUN npm install --omit=dev
COPY relay.js ./
RUN mkdir -p data
EXPOSE 8765
CMD ["node", "relay.js"]
