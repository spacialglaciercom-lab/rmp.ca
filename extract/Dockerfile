# Use AWS ECR Public Gallery mirror to avoid Docker Hub TLS timeouts behind VPNs
FROM public.ecr.aws/docker/library/node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
EXPOSE 4000
ENV PORT=4000
CMD ["node", "server.js"]
