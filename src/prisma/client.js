const { PrismaClient } = require('@prisma/client');

// Create a single instance of Prisma Client to talk to the database
// This prevents having too many connections open
const prisma = new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
});

module.exports = prisma;
