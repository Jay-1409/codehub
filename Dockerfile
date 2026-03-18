# Use official Node.js image
FROM node:18

# Install Oracle Instant Client dependencies
RUN apt-get update && apt-get install -y \
    libaio1 \
    wget \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Download and install Oracle Instant Client
WORKDIR /opt/oracle
RUN wget https://download.oracle.com/otn_software/linux/instantclient/2115000/instantclient-basic-linux.x64-21.15.0.0.0dbru.zip && \
    unzip instantclient-basic-linux.x64-21.15.0.0.0dbru.zip && \
    rm instantclient-basic-linux.x64-21.15.0.0.0dbru.zip && \
    echo /opt/oracle/instantclient_21_15 > /etc/ld.so.conf.d/oracle-instantclient.conf && \
    ldconfig

# Set environment variable for Oracle libraries
ENV LD_LIBRARY_PATH=/opt/oracle/instantclient_21_15:$LD_LIBRARY_PATH

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Build frontend
RUN npm run build

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "server.js"]
