const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const adminId = 1;
  const newPassword = 'admin123';

  const updatedUser = await prisma.users.update({
    where: { id: adminId },
    data: { password_hash: newPassword }
  });

  console.log(`Password reset for user ${updatedUser.username} (ID: ${updatedUser.id}) to '${newPassword}'`);
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
