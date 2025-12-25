const catchAsync = require('../utils/catchAsync');
const prisma = require('../prisma/client');

/**
 * @desc Export company data backup
 * @route POST /api/backup/export
 * @access Private
 */
exports.exportBackup = catchAsync(async (req, res) => {
    const { scope, include } = req.body;
    const companyId = req.user.company_id;

    if (!companyId) {
        return res.status(400).json({
            success: false,
            message: 'Company ID is required'
        });
    }

    const backupData = {
        metadata: {
            version: '1.0',
            timestamp: new Date().toISOString(),
            company_id: companyId,
            scope
        },
        data: {}
    };

    try {
        // Include company settings
        if (scope === 'full' || (include && include.includes('settings'))) {
            backupData.data.settings = await prisma.company_settings.findMany({
                where: { company_id: companyId }
            });
        }

        // Include invoices
        if (scope === 'full' || (include && include.includes('invoices'))) {
            backupData.data.invoices = await prisma.invoices.findMany({
                where: { company_id: companyId },
                include: {
                    invoice_items: true,
                    customers: true
                }
            });
        }

        // Include products
        if (scope === 'full' || (include && include.includes('products'))) {
            backupData.data.products = await prisma.products.findMany({
                where: { company_id: companyId },
                include: {
                    categories: true,
                    units_of_measure: true
                }
            });
        }

        // Include customers
        if (scope === 'full' || (include && include.includes('customers'))) {
            backupData.data.customers = await prisma.customers.findMany({
                where: { company_id: companyId }
            });
        }

        // Include employees
        if (scope === 'full' || (include && include.includes('employees'))) {
            backupData.data.employees = await prisma.employees.findMany({
                where: { company_id: companyId }
            });
        }

        // Send as JSON download
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=acculynce-backup-${new Date().toISOString().split('T')[0]}.json`);
        res.send(JSON.stringify(backupData, null, 2));

    } catch (error) {
        console.error('Backup export error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create backup',
            error: error.message
        });
    }
});

/**
 * @desc Restore company data from backup
 * @route POST /api/backup/restore
 * @access Private
 */
exports.restoreBackup = catchAsync(async (req, res) => {
    const companyId = req.user.company_id;

    if (!req.file) {
        return res.status(400).json({
            success: false,
            message: 'Backup file is required'
        });
    }

    try {
        // Parse backup file
        const backupData = JSON.parse(req.file.buffer.toString('utf-8'));

        // Validate backup format
        if (!backupData.metadata || !backupData.data) {
            return res.status(400).json({
                success: false,
                message: 'Invalid backup file format'
            });
        }

        const recordsRestored = {};

        // Restore within a transaction
        await prisma.$transaction(async (tx) => {
            // Restore settings (update rather than replace)
            if (backupData.data.settings && backupData.data.settings.length > 0) {
                for (const setting of backupData.data.settings) {
                    await tx.company_settings.upsert({
                        where: { id: setting.id },
                        update: {
                            ...setting,
                            company_id: companyId,
                            id: undefined
                        },
                        create: {
                            ...setting,
                            id: undefined,
                            company_id: companyId
                        }
                    });
                }
                recordsRestored.settings = backupData.data.settings.length;
            }

            // Restore customers
            if (backupData.data.customers) {
                for (const customer of backupData.data.customers) {
                    const { id, created_at, updated_at, ...customerData } = customer;
                    await tx.customers.create({
                        data: {
                            ...customerData,
                            company_id: companyId
                        }
                    });
                }
                recordsRestored.customers = backupData.data.customers.length;
            }

            // Restore products (simplified - you may need to handle categories/UOM)
            if (backupData.data.products) {
                for (const product of backupData.data.products) {
                    const { id, created_at, updated_at, categories, units_of_measure, ...productData } = product;
                    await tx.products.create({
                        data: {
                            ...productData,
                            company_id: companyId
                        }
                    });
                }
                recordsRestored.products = backupData.data.products.length;
            }

            // Note: Invoices restoration is more complex and might need careful handling
            // of invoice_items, customer references, etc.
        });

        res.status(200).json({
            success: true,
            message: 'Data restored successfully',
            recordsRestored
        });

    } catch (error) {
        console.error('Restore error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to restore backup',
            error: error.message
        });
    }
});
