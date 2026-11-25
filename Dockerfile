FROM node:24-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY core/package.json core/
COPY cli/package.json cli/
COPY app/package.json app/
COPY widgets/package.json widgets/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/build/tomewise /opt/tomewise
RUN ln -s /opt/tomewise/lib/tome.js /usr/local/bin/tome
ENV TOMEWISE_INSTALL=docker \
  TOMEWISE_HOST=0.0.0.0 \
  TOMEWISE_PORT=4777 \
  TOMEWISE_HOME=/learning-home
WORKDIR /learning-home
VOLUME /learning-home
USER node
EXPOSE 4777
ENTRYPOINT ["tome"]
CMD ["serve"]
