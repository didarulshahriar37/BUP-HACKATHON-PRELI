# Use lightweight official Node 22 runtime
FROM node:22-alpine

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source and data
COPY src/ ./src/
COPY data/ ./data/

# Expose service port and configure environment
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

# Start the GridWise service
CMD ["node", "src/server.js"]
