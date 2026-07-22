FROM node:22-slim AS builder

WORKDIR /app

# Install system dependencies for native modules (glibc)
RUN apt-get update && apt-get install -y python3 make g++ bzip2 ca-certificates && rm -rf /var/lib/apt/lists/*

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

# Copy workspace configurations
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY apps/speech/package.json ./apps/speech/
COPY apps/worker/package.json ./apps/worker/

# Install dependencies
RUN pnpm install

# Copy source code
COPY . .

# Build contracts and applications
RUN pnpm build

EXPOSE 3000 4000 4001

CMD ["pnpm", "--filter", "@xz/web", "start"]
