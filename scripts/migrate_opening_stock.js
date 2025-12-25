const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function migrateOpeningStock() {
    console.log('🚀 Starting Opening Stock Migration...');
    console.log('Only migrating if Legacy Stock > New Stock Balance (Positive Gap).');

    const products = await prisma.products.findMany({
        where: { is_active: true },
        include: {
            stock_balance: true
        }
    });

    for (const p of products) {
        const legacy = parseFloat(p.stock || 0);

        let balance = 0;
        if (p.stock_balance.length > 0) {
            balance = p.stock_balance.reduce((sum, sb) => sum + parseFloat(sb.quantity || 0), 0);
        }

        const gap = legacy - balance;

        // Tolerance for float math
        if (gap > 0.01) {
            console.log(`Product [${p.id}] ${p.name}: Legacy=${legacy}, Balance=${balance} => Gap=${gap}`);

            // Get Warehouse (Main Store)
            const warehouse = await prisma.warehouses.findFirst({
                where: { company_id: p.company_id, is_active: true }
            });

            if (!warehouse) {
                console.warn(`   ⚠️ No warehouse for company ${p.company_id}. Skipping.`);
                continue;
            }

            console.log(`   -> Adding ${gap} as Opening Stock...`);

            // 1. Update/Create Stock Balance
            await prisma.stock_balance.upsert({
                where: {
                    product_id_warehouse_id: {
                        product_id: p.id,
                        warehouse_id: warehouse.id
                    }
                },
                update: {
                    quantity: { increment: gap }
                    // available_quantity is generated
                },
                create: {
                    product_id: p.id,
                    warehouse_id: warehouse.id,
                    quantity: gap,
                    // available_quantity is generated
                    reserved_quantity: 0,
                    company_id: p.company_id
                }
            });

            // 2. Create Transaction
            await prisma.stock_transactions.create({
                data: {
                    company_id: p.company_id,
                    transaction_type: 'ADJUSTMENT',
                    product_id: p.id,
                    warehouse_id: warehouse.id,
                    quantity: gap,
                    reference_type: 'Migration',
                    reference_id: 0,
                    remarks: `Legacy Opening Stock Migration (Auto)`,
                    created_by: null
                }
            });

            console.log('   ✅ Done.');
        } else if (gap < -0.01) {
            // Debug log only
            console.log(`Product [${p.id}] ${p.name}: New Balance (${balance}) > Legacy (${legacy}). Keeping New Balance.`);
        }
    }

    console.log('🏁 Migration Complete.');
}

migrateOpeningStock()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
