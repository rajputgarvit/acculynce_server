const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const companyId = 13; // From logs
    console.log(`Checking Stock Value for Company ${companyId}...`);

    const products = await prisma.products.findMany({
        where: { company_id: companyId },
        select: { id: true, name: true, stock: true, standard_cost: true, product_type: true, is_active: true }
    });

    console.log(`Found ${products.length} active products.`);

    let totalStockValue = 0;
    products.forEach(p => {
        const qty = Number(p.stock || 0);
        const cost = Number(p.standard_cost || 0);
        const val = qty * cost;

        console.log(`[ID: ${p.id}] ${p.name}: Type=${p.product_type}, Active=${p.is_active}, Stock=${qty}, Cost=${cost} => Val=${val}`);

        if (p.product_type !== 'Service') {
            totalStockValue += val;
        } else {
            console.log(`   -> Skipped (Service)`);
        }
    });

    console.log(`Total Closing Stock Value: ${totalStockValue}`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
