const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.users.findMany();
  console.log('Users found:', users.map(u => ({ id: u.id, email: u.email, username: u.username, role: u.role_id }))); // Role might be in a relation, but checking basics
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
