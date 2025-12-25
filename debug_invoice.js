const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function debug() {
    try {
        const invoiceId = 12;
        console.log(`--- Debugging Invoice ID: ${invoiceId} ---`);

        const invoice = await prisma.invoices.findUnique({
            where: { id: invoiceId },
            include: {
                invoice_items: {
                    include: {
                        products: true
                    }
                }
            }
        });

        if (!invoice) {
            console.log("Invoice not found!");
            return;
        }

        console.log(`Invoice Number: ${invoice.invoice_number}`);
        console.log(`Total Amount: ${invoice.total_amount}`);
        console.log(`Tax Amount: ${invoice.tax_amount}`);

        console.log("\n--- Invoice Items ---");
        invoice.invoice_items.forEach((item, i) => {
            console.log(`Item ${i + 1}: ${item.products.name}`);
            console.log(`  - Line Total: ${item.line_total}`);
            console.log(`  - Item Tax Rate (stored): ${item.tax_rate}`);
            console.log(`  - Product Tax Rate (original): ${item.products.tax_rate}`);
        });

    } catch (err) {
        console.error(err);
    } finally {
        await prisma.$disconnect();
    }
}

debug();
