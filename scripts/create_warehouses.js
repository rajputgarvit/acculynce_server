const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createDefaultWarehouses() {
    console.log('🏭 Checking for missing warehouses...');

    const companies = await prisma.company_settings.findMany();

    for (const company of companies) {
        const warehouse = await prisma.warehouses.findFirst({
            where: { company_id: company.id }
        });

        if (!warehouse) {
            console.log(`Creating warehouse for Company ${company.id} (${company.company_name})...`);
            await prisma.warehouses.create({
                data: {
                    company_id: company.id,
                    name: 'Main Store',
                    code: `WH_${company.id}`,
                    is_active: true
                }
            });
        }
    }

    console.log('✅ Warehouse check complete.');
}

createDefaultWarehouses()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
