const axios = require('axios');

// Use env var or fallback (User requested to use creds given earlier)
// In a real app, strictly use process.env.RESEND_API_KEY
const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = 'no-reply@acculynce.com';
const FROM_NAME = 'Acculynce Systems';

const sendEmail = async (options) => {
    // options: { email, subject, message, html }

    const data = {
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [options.email],
        subject: options.subject,
        html: options.html || options.message
    };

    try {
        await axios.post('https://api.resend.com/emails', data, {
            headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`✅ Email sent to ${options.email}`);
    } catch (error) {
        console.error('❌ Resend API Error:', error.response?.data || error.message);
        // Throwing error allows the controller to decide handles it, but often we don't want to break the flow
        throw error;
    }
};

module.exports = sendEmail;
