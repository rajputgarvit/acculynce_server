const prisma = require('../prisma/client');
const catchAsync = require('../utils/catchAsync');

/**
 * Get all active subscription plans with features and modules included.
 * This is used for the public pricing page.
 */
exports.getPublicPlans = catchAsync(async (req, res, next) => {
    const plans = await prisma.subscription_plans.findMany({
        where: {
            is_active: true
        },
        include: {
            plan_features: {
                where: {
                    is_enabled: true
                }
            },
            plan_modules: {
                where: {
                    is_enabled: true
                }
            }
        },
        orderBy: {
            display_order: 'asc'
        }
    });

    res.status(200).json({
        status: 'success',
        results: plans.length,
        data: plans
    });
});
