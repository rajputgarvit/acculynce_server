const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkWarehouse() {
    // Check warehouses for company 13
    const warehouses = await prisma.warehouses.findMany({
        where: { company_id: 13 }
    });
    console.log('Warehouses for Company 13:', warehouses);

    if (warehouses.length === 0) {
        console.log('Fetching all warehouses to check structure...');
        const all = await prisma.warehouses.findMany({ take: 5 });
        console.log(all);
    }
}

checkWarehouse()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
