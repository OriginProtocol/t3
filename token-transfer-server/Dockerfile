FROM --platform=linux/amd64 node:16

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
COPY ./ /app

RUN yarn install

CMD npm run migrate && npm run start

