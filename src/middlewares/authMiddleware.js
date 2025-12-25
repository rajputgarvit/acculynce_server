const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.protect = async (req, res, next) => {
    try {
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({ status: 'fail', message: 'You are not logged in!' });
        }

        // Validate token (Basic Mock Validation for MVP)
        // Token format: "mock-jwt-token-{userId}"
        if (!token.startsWith('mock-jwt-token-')) {
            return res.status(401).json({ status: 'fail', message: 'Invalid token' });
        }

        const userId = parseInt(token.split('-').pop());

        const currentUser = await prisma.users.findUnique({
            where: { id: userId }
        });

        if (!currentUser) {
            return res.status(401).json({ status: 'fail', message: 'User belonging to this token no longer exists.' });
        }

        // Fetch and attach roles
        const userRoles = await prisma.user_roles.findMany({
            where: { user_id: currentUser.id },
            include: { roles: true }
        });
        currentUser.roles = userRoles.map(ur => ur.roles.name);

        req.user = currentUser;
        next();
    } catch (error) {
        res.status(401).json({ status: 'fail', message: 'Not authorized' });
    }
};
