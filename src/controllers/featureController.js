const prisma = require('../prisma/client');
const catchAsync = require('../utils/catchAsync');

exports.getAllFeatures = catchAsync(async (req, res, next) => {
    // Fetch all active features, ordered by display_order
    const features = await prisma.feature_definitions.findMany({
        where: {
            is_active: true
        },
        orderBy: {
            display_order: 'asc'
        }
    });

    res.status(200).json({
        status: 'success',
        results: features.length,
        data: {
            features: features
        }
    });
});
