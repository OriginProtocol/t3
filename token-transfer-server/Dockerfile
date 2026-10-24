FROM --platform=linux/amd64 node:24.22.1

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
COPY ./ /app

RUN yarn install

CMD npm run migrate && npm run start

