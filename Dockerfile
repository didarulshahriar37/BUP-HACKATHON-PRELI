# Use lightweight official Node 22 runtime
FROM node:22-alpine

WORKDIR /app

# Install production dependencies deterministically
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source and data
COPY src/ ./src/
COPY data/ ./data/

# Set file permissions for non-root user
RUN chown -R node:node /app

# Run container as unprivileged user for security
USER node

# Expose service port and configure environment
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

# Healthcheck monitoring using Node built-in fetch
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the GridWise service
CMD ["node", "src/server.js"]

