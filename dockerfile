# Use the official Node.js image as the base image
FROM node:22

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to install dependencies
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy prisma separately (important!)
COPY prisma ./prisma

# Copy the rest of the application code
COPY . .

# Copy the start script and make it executable
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

# Generate Prisma client
RUN npx prisma generate

# Install TypeScript globally
RUN npm install -g typescript

# Expose the port your Node.js app runs on
EXPOSE 3000

# Command to run the application
CMD ["npm", "start"]
