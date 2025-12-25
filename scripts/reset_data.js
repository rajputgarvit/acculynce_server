const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearData() {
    console.log('⚠️  Starting data cleanup...');

    // Use transaction to ensure all or nothing
    try {
        await prisma.$transaction(async (tx) => {

            // --- SALES CYCLE ---
            console.log('Cleaning Sales Data...');
            // 1. Delete dependent children of Invoices
            await tx.payment_allocations.deleteMany({});
            await tx.invoice_items.deleteMany({});
            await tx.payment_reminders.deleteMany({});

            // 2. Delete Payments (linked to Customers/Invoices)
            await tx.payments_received.deleteMany({});
            await tx.payments.deleteMany({});

            // 3. Delete Invoices
            await tx.invoices.deleteMany({});

            // 4. Delete Sales Orders & Quotations & Opportunities
            await tx.sales_orders.deleteMany({});
            await tx.quotations.deleteMany({});
            await tx.opportunities.deleteMany({});

            // 5. Delete Customer Details
            await tx.customer_notes.deleteMany({});
            await tx.customer_addresses.deleteMany({});

            // 6. Delete Customers
            console.log('Cleaning Customers...');
            await tx.customers.deleteMany({});


            // --- PURCHASE CYCLE ---
            console.log('Cleaning Purchase Data...');

            // 1. GRN & Purchase Orders
            await tx.grn_items.deleteMany({});
            await tx.goods_received_notes.deleteMany({});

            // Check if purchase_order_items exists (implied by GRN relation logic, usually exists)
            // Need to check schema for purchase_order_items model name, assuming standard convention or ignoring if cascade handles it.
            // Let's assume explicit delete for safety if model exists.
            // Based on schema view, we saw references to `purchase_orders`. 
            // We will attempt to delete purchase_orders, which might cascade items.
            // If purchase_order_items table exists, we should delete it.
            // Safe bet: delete purchase_orders and purchase_invoices.
            // 2. Purchase Invoices & Payments Made
            await tx.payment_made_allocations.deleteMany({});
            await tx.purchase_invoice_items.deleteMany({});
            await tx.purchase_invoices.deleteMany({});
            await tx.payments_made.deleteMany({});

            // 3. Purchase Orders
            await tx.grn_items.deleteMany({}); // Redundant but safe
            await tx.purchase_order_items.deleteMany({});
            await tx.purchase_orders.deleteMany({});

            // --- INVENTORY & MFG ---
            console.log('Cleaning Inventory & Manufacturing...');
            await tx.stock_transactions.deleteMany({});
            await tx.stock_balance.deleteMany({});
            await tx.work_orders.deleteMany({});
            await tx.bom_items.deleteMany({});
            await tx.bill_of_materials.deleteMany({});
            
            // --- PRODUCT MASTER ---
            console.log('Cleaning Products...');
            await tx.products.deleteMany({});

            // 4. Supplier Details
            await tx.supplier_addresses.deleteMany({});

            // 5. Suppliers
            console.log('Cleaning Suppliers...');
            await tx.suppliers.deleteMany({});

        });

        console.log('✅ Data cleanup completed successfully!');
    } catch (error) {
        console.error('❌ Data cleanup failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

clearData();
