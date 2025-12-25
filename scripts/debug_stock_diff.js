const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function debugStockDiff() {
    console.log('🔍 Comparing Legacy Stock vs New Stock Balance...');

    const products = await prisma.products.findMany({
        where: { is_active: true },
        include: {
            stock_balance: true
        }
    });

    console.log('---------------------------------------------------------------------------------');
    console.log('| ID | Product Name                   | Legacy (stock) | Balance (New) | Diff |');
    console.log('---------------------------------------------------------------------------------');

    for (const p of products) {
        const legacy = parseFloat(p.stock || 0);
        let balance = 0;
        if (p.stock_balance.length > 0) {
            balance = p.stock_balance.reduce((sum, sb) => sum + parseFloat(sb.quantity || 0), 0);
        }

        const diff = legacy - balance;

        if (Math.abs(diff) > 0.01 || legacy > 0) {
            console.log(`| ${p.id.toString().padEnd(2)} | ${p.name.substring(0, 30).padEnd(30)} | ${legacy.toFixed(2).padStart(14)} | ${balance.toFixed(2).padStart(13)} | ${diff.toFixed(2).padStart(4)} |`);
        }
    }
    console.log('---------------------------------------------------------------------------------');
}

debugStockDiff()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
