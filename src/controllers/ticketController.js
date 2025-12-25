const prisma = require('../prisma/client');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

/**
 * Handle Ticket Categories
 */
exports.getCategories = catchAsync(async (req, res, next) => {
    const categories = await prisma.support_categories.findMany();
    res.status(200).json({ status: 'success', data: categories });
});

/**
 * Create a new Support Ticket
 */
exports.createTicket = catchAsync(async (req, res, next) => {
    const { category_id, subject, message, priority } = req.body;
    const user_id = req.user.id;

    // Generate unique ticket number (e.g., TKT-2025-99AA19)
    const year = new Date().getFullYear();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    const ticket_number = `TKT-${year}-${random}`;

    const result = await prisma.$transaction(async (tx) => {
        // 1. Create the Ticket
        const ticket = await tx.support_tickets.create({
            data: {
                ticket_number,
                user_id,
                category_id: parseInt(category_id),
                subject,
                priority: priority || 'Medium',
                status: 'Open'
            }
        });

        // 2. Create the first reply (the ticket message)
        await tx.support_ticket_replies.create({
            data: {
                ticket_id: ticket.id,
                user_id,
                message
            }
        });

        return ticket;
    });

    res.status(201).json({ status: 'success', data: result });
});

/**
 * Get tickets for the logged-in user
 */
exports.getUserTickets = catchAsync(async (req, res, next) => {
    const user_id = req.user.id;
    const tickets = await prisma.support_tickets.findMany({
        where: { user_id },
        include: {
            support_categories: true
        },
        orderBy: { created_at: 'desc' }
    });

    res.status(200).json({ status: 'success', data: tickets });
});

/**
 * Get all tickets for Super Admin
 */
exports.getAllTickets = catchAsync(async (req, res, next) => {
    const { status, priority, category_id } = req.query;

    const where = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (category_id) where.category_id = parseInt(category_id);

    const tickets = await prisma.support_tickets.findMany({
        where,
        include: {
            support_categories: true,
            users_support_tickets_user_idTousers: {
                select: { id: true, full_name: true, email: true, company_name: true }
            }
        },
        orderBy: { created_at: 'desc' }
    });

    res.status(200).json({ status: 'success', data: tickets });
});

/**
 * Get ticket details with full thread
 */
exports.getTicketDetails = catchAsync(async (req, res, next) => {
    const { ticketNumber } = req.params;

    const ticket = await prisma.support_tickets.findUnique({
        where: { ticket_number: ticketNumber },
        include: {
            support_categories: true,
            users_support_tickets_user_idTousers: {
                select: { id: true, full_name: true, email: true, company_name: true }
            },
            support_ticket_replies: {
                include: {
                    users: {
                        select: { id: true, full_name: true, avatar_path: true }
                    }
                },
                orderBy: { created_at: 'asc' }
            }
        }
    });

    if (!ticket) {
        return next(new AppError('No ticket found with that ID', 404));
    }

    // Security check: only the owner or an admin can view
    // Since this is a shared controller, we'll check against req.user
    // If it's not super_admin and not the owner, deny access
    // This assumes req.user.roles is available from the protect middleware
    const userRoles = req.user.roles || [];
    const isSuperAdmin = userRoles.includes('Super Admin');

    if (!isSuperAdmin && ticket.user_id !== req.user.id) {
        return next(new AppError('You do not have permission to view this ticket', 403));
    }

    res.status(200).json({ status: 'success', data: ticket });
});

/**
 * Reply to a ticket
 */
exports.replyToTicket = catchAsync(async (req, res, next) => {
    const { ticketNumber } = req.params;
    const { message } = req.body;
    const user_id = req.user.id;

    // Verify ticket exists
    const ticket = await prisma.support_tickets.findUnique({ where: { ticket_number: ticketNumber } });
    if (!ticket) return next(new AppError('Ticket not found', 404));

    const reply = await prisma.support_ticket_replies.create({
        data: {
            ticket_id: ticket.id,
            user_id,
            message
        },
        include: {
            users: { select: { id: true, full_name: true, avatar_path: true } }
        }
    });

    // If an admin replies, maybe set status to In Progress
    if ((req.user.roles || []).includes('Super Admin') && ticket.status === 'Open') {
        await prisma.support_tickets.update({
            where: { id: ticket.id },
            data: { status: 'In_Progress' }
        });
    }

    res.status(201).json({ status: 'success', data: reply });
});

/**
 * Update ticket status (Super Admin only)
 */
exports.updateTicketStatus = catchAsync(async (req, res, next) => {
    const { ticketNumber } = req.params;
    const { status } = req.body;

    const ticket = await prisma.support_tickets.update({
        where: { ticket_number: ticketNumber },
        data: { status }
    });

    res.status(200).json({ status: 'success', data: ticket });
});
