const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function syncPurchaseStock() {
    console.log('🔄 Starting Purchase Stock Sync...');

    try {
        // 1. Get all purchase invoices with items
        const purchases = await prisma.purchase_invoices.findMany({
            include: {
                purchase_invoice_items: true
            }
        });

        console.log(`found ${purchases.length} purchase invoices.`);

        for (const purchase of purchases) {
            console.log(`Processing Purchase #${purchase.bill_number}...`);

            // Get Company's default warehouse
            const warehouse = await prisma.warehouses.findFirst({
                where: { company_id: purchase.company_id, is_active: true }
            });

            if (!warehouse) {
                console.warn(`⚠️ No active warehouse found for Company ${purchase.company_id}. Skipping.`);
                continue;
            }

            for (const item of purchase.purchase_invoice_items) {
                const qty = parseFloat(item.quantity) || 0;
                if (qty <= 0) continue;

                // Check if transaction already exists to avoid double counting
                // We assume one transaction per item per reference_id (invoice id)
                const existingTx = await prisma.stock_transactions.findFirst({
                    where: {
                        reference_type: 'Purchase Invoice',
                        reference_id: purchase.id,
                        product_id: item.product_id,
                        transaction_type: 'PURCHASE'
                    }
                });

                if (existingTx) {
                    console.log(`   - Item ${item.product_id}: Transaction already exists. Skipping.`);
                    // Optional: Check if qty matches? For now, assume if exists, it's done.
                    continue;
                }

                console.log(`   - Item ${item.product_id}: Adding ${qty} to stock...`);

                // 1. Update Stock Balance
                await prisma.stock_balance.upsert({
                    where: {
                        product_id_warehouse_id: {
                            product_id: item.product_id,
                            warehouse_id: warehouse.id
                        }
                    },
                    update: {
                        quantity: { increment: qty }
                        // available_quantity is generated column
                    },
                    create: {
                        product_id: item.product_id,
                        warehouse_id: warehouse.id,
                        quantity: qty,
                        // available_quantity is generated column
                        reserved_quantity: 0,
                        company_id: purchase.company_id
                    }
                });

                // 2. Create Transaction Record
                await prisma.stock_transactions.create({
                    data: {
                        company_id: purchase.company_id,
                        transaction_type: 'PURCHASE',
                        product_id: item.product_id,
                        warehouse_id: warehouse.id,
                        quantity: qty,
                        reference_type: 'Purchase Invoice',
                        reference_id: purchase.id,
                        remarks: `Sync: Purchase Bill ${purchase.bill_number}`,
                        created_by: purchase.created_by // or null
                    }
                });
            }
        }

        console.log('✅ Stock Sync Completed Successfully.');

    } catch (error) {
        console.error('❌ Error syncing stock:', error);
    } finally {
        await prisma.$disconnect();
    }
}

syncPurchaseStock();
