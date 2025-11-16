FROM node:20

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY prisma ./prisma

# Now copy the rest
COPY . .

# Generate the client
RUN npx prisma generate

EXPOSE 3001
CMD ["npm", "run", "start:dev"]
