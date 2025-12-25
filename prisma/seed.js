
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const defaultUOMs = [
    { name: 'Nos', symbol: 'Nos' },
    { name: 'Pieces', symbol: 'Pcs' },
    { name: 'Kilograms', symbol: 'Kg' },
    { name: 'Liters', symbol: 'Ltr' },
    { name: 'Meters', symbol: 'Mtr' },
    { name: 'Boxes', symbol: 'Box' },
    { name: 'Sets', symbol: 'Set' },
    { name: 'Dozens', symbol: 'Doz' },
    { name: 'Hours', symbol: 'Hr' },
    { name: 'Days', symbol: 'Day' }
  ];

  console.log('Seeding Units of Measure...');

  for (const uom of defaultUOMs) {
    const exists = await prisma.units_of_measure.findFirst({
        where: { name: uom.name }
    });

    if (!exists) {
        // According to schema: name (String), symbol (String), type (default 'Quantity')
        await prisma.units_of_measure.create({
            data: {
                name: uom.name,
                symbol: uom.symbol
                // company_id is nullable, assuming null is global/default
            }
        });
        console.log(`Created UOM: ${uom.name}`);
    } else {
        console.log(`Skipped (already exists): ${uom.name}`);
    }
  }

  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
