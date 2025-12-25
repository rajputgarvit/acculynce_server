const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('Deleting all suppliers...');
    try {
        const { count } = await prisma.suppliers.deleteMany({});
        console.log(`Deleted ${count} suppliers.`);
    } catch (error) {
        console.error('Error deleting suppliers:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
