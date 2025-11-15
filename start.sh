#!/bin/sh

# Wait for database to be ready
echo "⏳ Waiting for database..."
until npx prisma db pull > /dev/null 2>&1; do
  sleep 1
done

echo "✅ Database is up, running migrations..."
npx prisma migrate deploy

echo "🚀 Starting app..."
npm start