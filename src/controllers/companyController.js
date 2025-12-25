const { PrismaClient } = require('@prisma/client');
const sendEmail = require('../utils/email'); // Import email utility
const prisma = new PrismaClient();

exports.createCompany = async (req, res) => {
    try {
        const userId = req.user.id; // Assumes verification middleware sets req.user
        const { 
            company_name, 
            industry_type, 
            business_type, 
            address_line1,
            address_line2, 
            city, 
            state, 
            postal_code,
            country, 
            phone,
            company_email,
            website,
            gstin,
            pan
        } = req.body;

        if (!userId) {
            return res.status(401).json({ status: 'fail', message: 'User not authenticated' });
        }

        // Check for duplicate Company Email, Phone, PAN, or GSTIN
        const orConditions = [];
        if (phone) orConditions.push({ phone });
        // Use provided company_email or fallback to user email for the check logic to match insertion logic
        const targetEmail = company_email || req.user.email;
        if (targetEmail) orConditions.push({ email: targetEmail });
        if (pan) orConditions.push({ pan });
        if (gstin) orConditions.push({ gstin });

        if (orConditions.length > 0) {
            const existingCompany = await prisma.company_settings.findFirst({
                where: {
                    OR: orConditions
                }
            });

            if (existingCompany) {
                let duplicateField = 'detail';
                if (existingCompany.phone === phone) duplicateField = 'Phone Number';
                else if (existingCompany.email === targetEmail) duplicateField = 'Company Email';
                else if (existingCompany.pan === pan) duplicateField = 'PAN Number';
                else if (existingCompany.gstin === gstin) duplicateField = 'GSTIN';
                
                return res.status(400).json({
                    status: 'fail',
                    message: `A company with this ${duplicateField} already exists.`
                });
            }
        }

        // 1. Create Company Settings
        const newCompany = await prisma.company_settings.create({
            data: {
                company_name,
                industry_type,
                business_type,
                address_line1,
                address_line2,
                city,
                state,
                postal_code,
                country: country || 'India',
                phone,
                email: company_email || req.user.email, // Use provided email or fallback to user email
                website,
                gstin,
                pan,
                created_at: new Date(),
                updated_at: new Date()
            }
        });

        // 2. Update User with new Company ID and role (Admin)
        await prisma.users.update({
            where: { id: userId },
            data: { 
                company_id: newCompany.id,
                company_name: newCompany.company_name
            }
        });

        // 3. Send Confirmation Email
        const message = `
            <h1>Welcome to Acculynce!</h1>
            <p>Your company <strong>${company_name}</strong> has been successfully registered.</p>
            <h3>Company Details:</h3>
            <ul>
                <li><strong>Industry:</strong> ${industry_type}</li>
                <li><strong>Business Type:</strong> ${business_type}</li>
                <li><strong>Location:</strong> ${city}, ${state}</li>
                <li><strong>GSTIN:</strong> ${gstin || 'N/A'}</li>
            </ul>
            <p>You can now access your dashboard and start managing your business.</p>
        `;

        try {
            await sendEmail({
                email: req.user.email,
                subject: 'Company Registration Successful - Acculynce',
                message: `Your company ${company_name} has been registered successfully.`, // Fallback text
                html: message
            });
        } catch (emailError) {
            console.error("Failed to send email:", emailError);
            // Don't fail the request if email fails, just log it
        }

        res.status(201).json({
            status: 'success',
            data: {
                company: newCompany
            }
        });

    } catch (error) {
        console.error("Company Creation Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};
