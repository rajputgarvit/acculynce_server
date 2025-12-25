const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Cleaning up data...');
  try {
    const deletedItems = await prisma.invoice_items.deleteMany({});
    console.log(`Deleted ${deletedItems.count} invoice_items.`);
    
    const deletedInvoices = await prisma.invoices.deleteMany({});
    console.log(`Deleted ${deletedInvoices.count} invoices.`);

  } catch (e) {
    console.error('Error cleaning up:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
