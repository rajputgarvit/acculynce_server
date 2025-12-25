const axios = require('axios');

async function check() {
    try {
        // We'll just check the DB directly to see if any weirdness exists in the fields
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        
        const prods = await prisma.products.findMany({
            take: 5,
            select: {
                id: true,
                name: true,
                tax_rate: true,
                selling_price: true
            }
        });
        
        console.log("--- Sample Products in DB ---");
        console.dir(prods, { depth: null });
        
        await prisma.$disconnect();
    } catch (err) {
        console.error(err);
    }
}

check();
