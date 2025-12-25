const prisma = require('./src/prisma/client');

async function checkPlans() {
  try {
    const plans = await prisma.subscription_plans.findMany({
      include: {
        plan_features: true,
        plan_modules: true
      }
    });
    console.log(JSON.stringify(plans, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

checkPlans();
