FROM node:20-slim

WORKDIR /app

# Install system dependencies if required for native builds (ca-certificates, curl)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*

# Copy package descriptors first for layer caching
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Launch server
CMD ["node", "src/server.js"]
