const prisma = require('./src/prisma/client');

async function getAdmin() {
  try {
    const adminRole = await prisma.roles.findFirst({ where: { name: 'Super Admin' } });
    if (!adminRole) {
      console.log('No Super Admin role found');
      return;
    }
    
    const userRole = await prisma.user_roles.findFirst({
      where: { role_id: adminRole.id },
      include: { users: true }
    });

    if (userRole && userRole.users) {
      console.log('Admin Email:', userRole.users.email);
      console.log('Admin Password Hash:', userRole.users.password_hash); // Just to verify existence
    } else {
      console.log('No user with Super Admin role found');
    }
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

getAdmin();
