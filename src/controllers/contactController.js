const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const sendEmail = require('../utils/email');

exports.submitContactrequest = catchAsync(async (req, res, next) => {
    const { name, email, message, subject } = req.body;

    if (!name || !email || !message) {
        return next(new AppError('Please provide name, email and message', 400));
    }

    // 1. Store in Database
    const contactRequest = await prisma.contact_requests.create({
        data: {
            name,
            email,
            message,
            subject: subject || 'New Contact Request',
            status: 'New'
        }
    });

    // 2. Send Email via Resend
    try {
        await sendEmail({
            email: 'support@acculynce.com', // Send to admin
            subject: `New Contact Request: ${subject || 'Inquiry'}`,
            html: `
            <h3>New Contact Request from ${name}</h3>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Message:</strong></p>
            <p>${message}</p>
          `
        });
    } catch (error) {
        console.error('Failed to send contact email:', error.message);
    }

    res.status(201).json({
        status: 'success',
        data: {
            contactRequest
        }
    });
});
