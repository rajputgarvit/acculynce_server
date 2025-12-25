const prisma = require('./src/prisma/client');

async function debugData() {
    try {
        console.log('--- Fetching Customers with Addresses ---');
        const customers = await prisma.customers.findMany({
            include: {
                customer_addresses: true
            },
            take: 5,
            orderBy: { created_at: 'desc' }
        });

        console.log(JSON.stringify(customers, null, 2));

        console.log('\n--- Checking Customer Addresses Table directly ---');
        const addresses = await prisma.customer_addresses.findMany({
            take: 5,
            orderBy: { id: 'desc' }
        });
        console.log(JSON.stringify(addresses, null, 2));

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

debugData();
