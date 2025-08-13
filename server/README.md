# Bookmarks Server

A minimal Express TypeScript server for the bookmarks application with SQLite database and UUID-based schema.

## Setup

```bash
# Install dependencies
npm install

# Set up the database (creates tables with UUID schema)
npm run db:setup

# Development mode (with auto-restart)
npm run dev

# Build
npm run build

# Production mode
npm start
```

## Database Management

The server uses SQLite with a UUID-based schema for better scalability and distributed systems support.

```bash
# Set up database (creates tables if they don't exist)
npm run db:setup

# Reset database (deletes and recreates all tables)
npm run db:reset

# Create a backup of the database
npm run db:backup

# Run UUID migration (if you have an old integer-based database)
npm run db:migrate
```

## Endpoints

- `GET /` - API information
- `GET /health` - Health check
- `POST /api/sync/:namespace/operations` - Sync bookmark operations

## Scripts

- `npm run dev` - Start development server with auto-restart
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm test` - Run tests (placeholder)
- `npm run db:setup` - Initialize database with UUID schema
- `npm run db:reset` - Reset database (delete and recreate)
- `npm run db:backup` - Create database backup
- `npm run db:migrate` - Migrate from integer IDs to UUIDs
