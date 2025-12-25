const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.getStates = async (req, res) => {
    try {
        const states = await prisma.indian_states.findMany({
            orderBy: {
                state_name: 'asc'
            }
        });

        res.status(200).json({
            status: 'success',
            data: {
                states
            }
        });
    } catch (error) {
        console.error("Get States Error:", error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch states' });
    }
};
