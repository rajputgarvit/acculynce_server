const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Dashboard Stats
// Dashboard Stats
exports.getDashboardStats = async (req, res) => {
    try {
        const [userCount, companyCount, subscriptionCount, activeTicketCount, recentCompanies] = await Promise.all([
            prisma.users.count(),
            prisma.company_settings.count(),
            prisma.subscriptions.count({ where: { status: 'active' } }),
            prisma.support_tickets.count({ where: { status: 'Open' } }),
            prisma.company_settings.findMany({
                take: 5,
                orderBy: { created_at: 'desc' },
                select: {
                    id: true,
                    company_name: true,
                    created_at: true,
                    email: true
                    // Add other fields if needed for the dashboard table
                }
            })
        ]);

        // To make the recent table more useful, we might want to attach current subscription status
        // But for now, let's just return the companies and handle subscription fetching or assume active
        // Or we can do a quick lookup for their latest subscription

        const recentWithSubs = await Promise.all(recentCompanies.map(async (comp) => {
            const sub = await prisma.subscriptions.findFirst({
                where: { company_id: comp.id },
                orderBy: { created_at: 'desc' },
                select: { plan_name: true, status: true }
            });
            return {
                ...comp,
                subscription: sub || { plan_name: 'None', status: 'inactive' }
            };
        }));

        res.status(200).json({
            status: 'success',
            data: {
                users: userCount,
                companies: companyCount,
                active_subscriptions: subscriptionCount,
                open_tickets: activeTicketCount,
                recent_registrations: recentWithSubs
            }
        });
    } catch (error) {
        console.error("Dashboard Stats Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// Users Module
exports.getAllUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const search = req.query.search || '';

        const where = search ? {
            OR: [
                { full_name: { contains: search } },
                { email: { contains: search } },
                { username: { contains: search } }
            ]
        } : {};

        const [users, total] = await Promise.all([
            prisma.users.findMany({
                where,
                skip,
                take: limit,
                select: {
                    id: true,
                    full_name: true,
                    email: true,
                    username: true,
                    company_name: true,
                    created_at: true,
                    is_active: true,
                    last_login: true
                },
                orderBy: { created_at: 'desc' }
            }),
            prisma.users.count({ where })
        ]);

        res.status(200).json({
            status: 'success',
            data: {
                users,
                meta: {
                    total,
                    page,
                    limit,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error("Get Users Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// Companies Module
exports.getAllCompanies = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const search = req.query.search || '';

        const where = search ? {
            OR: [
                { company_name: { contains: search } },
                { industry_type: { contains: search } },
                { email: { contains: search } }
            ]
        } : {};

        const [companies, total] = await Promise.all([
            prisma.company_settings.findMany({
                where,
                skip,
                take: limit,
                orderBy: { created_at: 'desc' }
            }),
            prisma.company_settings.count({ where })
        ]);

        res.status(200).json({
            status: 'success',
            data: {
                companies,
                meta: {
                    total,
                    page,
                    limit,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error("Get Companies Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// Subscriptions Module
exports.getAllSubscriptions = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // 1. Get the latest subscription ID for each company
        // Group by company_id and find the max ID (assuming higher ID = newer)
        const latestSubsGroups = await prisma.subscriptions.groupBy({
            by: ['company_id'],
            _max: {
                id: true
            }
        });

        // 2. Extract the IDs
        const latestIds = latestSubsGroups.map(group => group._max.id).filter(id => id !== null);

        // 3. Get total count of unique companies with subscriptions
        const total = latestIds.length;

        // 4. Fetch the actual subscription details for these IDs
        // Note: Prisma where 'in' clause ensures we only get these specific records
        const subscriptions = await prisma.subscriptions.findMany({
            where: {
                id: { in: latestIds }
            },
            skip,
            take: limit,
            include: {
                users: { select: { full_name: true, company_name: true } }
            },
            orderBy: { created_at: 'desc' }
        });

        res.status(200).json({
            status: 'success',
            data: {
                subscriptions,
                meta: {
                    total,
                    page,
                    limit,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error("Get Subscriptions Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};
// Company Details
exports.getCompanyDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = parseInt(id);

        // 1. Fetch Company Settings & Info
        const company = await prisma.company_settings.findUnique({
            where: { id: companyId }
        });

        if (!company) {
            return res.status(404).json({ status: 'fail', message: 'Company not found' });
        }

        // 2. Aggregate Stats
        const [
            // HR
            employeeCount,
            departmentCount,

            // Sales
            customerCount,
            quotationCount,
            salesOrderCount,
            invoiceCount,

            // Inventory
            productCount,
            warehouseCount,

            // Purchase
            supplierCount,
            purchaseOrderCount,
            purchaseInvoiceCount,

            // Accounting
            chartOfAccountsCount,
            journalEntryCount,

            // CRM
            leadCount,

            // Users
            users,

            // Subscriptions
            subscriptions
        ] = await Promise.all([
            // HR
            prisma.employees.count({ where: { company_id: companyId } }),
            prisma.departments.count({ where: { company_id: companyId } }),

            // Sales
            prisma.customers.count({ where: { company_id: companyId } }),
            prisma.quotations.count({ where: { company_id: companyId } }),
            prisma.sales_orders.count({ where: { company_id: companyId } }),
            prisma.invoices.count({ where: { company_id: companyId } }),

            // Inventory
            prisma.products.count({ where: { company_id: companyId } }),
            prisma.warehouses.count({ where: { company_id: companyId } }),

            // Purchase
            prisma.suppliers.count({ where: { company_id: companyId } }),
            prisma.purchase_orders.count({ where: { company_id: companyId } }),
            prisma.purchase_invoices.count({ where: { company_id: companyId } }),

            // Accounting
            prisma.chart_of_accounts.count({ where: { company_id: companyId } }),
            prisma.journal_entries.count({ where: { company_id: companyId } }),

            // CRM
            prisma.leads.count({ where: { company_id: companyId } }),

            // Users
            prisma.users.findMany({
                where: { company_id: companyId },
                select: {
                    id: true,
                    full_name: true,
                    email: true,
                    username: true,
                    is_active: true,
                    // roles: true // Need to handle relation properly if fetching roles
                }
            }),

            // Subscriptions
            prisma.subscriptions.findMany({
                where: { company_id: companyId },
                orderBy: { created_at: 'desc' }
            })
        ]);

        // Fetch roles for users manually to avoid complex include if not standard
        const usersWithRoles = await Promise.all(users.map(async (u) => {
            const roles = await prisma.user_roles.findMany({
                where: { user_id: u.id },
                include: { roles: true }
            });
            return {
                ...u,
                roles: roles.map(r => r.roles.name)
            };
        }));

        res.status(200).json({
            status: 'success',
            data: {
                company,
                stats: {
                    hr: { employees: employeeCount, departments: departmentCount },
                    sales: { customers: customerCount, quotations: quotationCount, salesOrders: salesOrderCount, invoices: invoiceCount },
                    inventory: { products: productCount, warehouses: warehouseCount },
                    purchase: { suppliers: supplierCount, purchaseOrders: purchaseOrderCount, purchaseInvoices: purchaseInvoiceCount },
                    accounting: { accounts: chartOfAccountsCount, journalEntries: journalEntryCount },
                    crm: { leads: leadCount }
                },
                users: usersWithRoles,
                subscriptions
            }
        });

    } catch (error) {
        console.error("Get Company Details Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// User Details
exports.getUserDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = parseInt(id);

        // 1. Fetch User Info
        const user = await prisma.users.findUnique({
            where: { id: userId },
            select: {
                id: true,
                full_name: true,
                email: true,
                username: true,
                // phone: true, // Phone might not be in users table based on schema, let's double check or exclude. 
                // Checked schema: phone IS NOT in users table. Removing it.
                company_name: true,
                company_id: true,
                created_at: true,
                last_login: true,
                is_active: true,
                avatar_path: true,
                email_verified: true,
                onboarding_completed: true
            }
        });

        if (!user) {
            return res.status(404).json({ status: 'fail', message: 'User not found' });
        }

        // 2. Fetch User Roles
        const userRoles = await prisma.user_roles.findMany({
            where: { user_id: userId },
            include: { roles: true }
        });
        const roles = userRoles.map(ur => ur.roles.name);

        // 3. Fetch Company Details (if associated)
        let company = null;
        if (user.company_id) {
            company = await prisma.company_settings.findUnique({
                where: { id: user.company_id }
            });
        }

        // 4. Fetch Recent Activity (Audit Logs)
        const activityLogs = await prisma.audit_logs.findMany({
            where: { user_id: userId },
            orderBy: { created_at: 'desc' },
            take: 10
        });

        res.status(200).json({
            status: 'success',
            data: {
                user: {
                    ...user,
                    roles: roles
                },
                company,
                activity_logs: activityLogs
            }
        });

    } catch (error) {
        console.error("Get User Details Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// Plan Management
exports.getAllPlans = async (req, res) => {
    try {
        const plans = await prisma.subscription_plans.findMany({
            include: {
                plan_features: true,
                plan_modules: true
            },
            orderBy: { display_order: 'asc' }
        });

        res.status(200).json({
            status: 'success',
            data: { plans }
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

exports.createPlan = async (req, res) => {
    try {
        const { plan_name, plan_code, monthly_price, annual_price, max_users, storage_gb, features, modules, is_active, display_order } = req.body;

        const result = await prisma.$transaction(async (tx) => {
            const plan = await tx.subscription_plans.create({
                data: {
                    plan_name,
                    plan_code,
                    monthly_price,
                    annual_price,
                    max_users,
                    storage_gb,
                    is_active,
                    display_order
                }
            });

            // Create features
            if (features && features.length > 0) {
                await tx.plan_features.createMany({
                    data: features.map(f => ({
                        plan_id: plan.id,
                        feature_code: f.feature_code,
                        feature_name: f.feature_name,
                        feature_category: f.feature_category,
                        is_enabled: f.is_enabled,
                        limit_value: f.limit_value
                    }))
                });
            }

            // Create modules
            if (modules && modules.length > 0) {
                await tx.plan_modules.createMany({
                    data: modules.map(m => ({
                        plan_id: plan.id,
                        module_code: m.module_code,
                        is_enabled: m.is_enabled
                    }))
                });
            }

            return plan;
        });

        res.status(201).json({
            status: 'success',
            data: { plan: result }
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

exports.updatePlan = async (req, res) => {
    try {
        const { id } = req.params;
        const { plan_name, plan_code, monthly_price, annual_price, max_users, storage_gb, features, modules, is_active, display_order } = req.body;

        const result = await prisma.$transaction(async (tx) => {
            const plan = await tx.subscription_plans.update({
                where: { id: parseInt(id) },
                data: {
                    plan_name,
                    plan_code,
                    monthly_price,
                    annual_price,
                    max_users,
                    storage_gb,
                    is_active,
                    display_order
                }
            });

            // Sync features (delete and recreate for simplicity or careful upsert)
            if (features) {
                await tx.plan_features.deleteMany({ where: { plan_id: plan.id } });
                await tx.plan_features.createMany({
                    data: features.map(f => ({
                        plan_id: plan.id,
                        feature_code: f.feature_code,
                        feature_name: f.feature_name,
                        feature_category: f.feature_category,
                        is_enabled: f.is_enabled,
                        limit_value: f.limit_value
                    }))
                });
            }

            // Sync modules
            if (modules) {
                await tx.plan_modules.deleteMany({ where: { plan_id: plan.id } });
                await tx.plan_modules.createMany({
                    data: modules.map(m => ({
                        plan_id: plan.id,
                        module_code: m.module_code,
                        is_enabled: m.is_enabled
                    }))
                });
            }

            return plan;
        });

        res.status(200).json({
            status: 'success',
            data: { plan: result }
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

exports.deletePlan = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.subscription_plans.delete({
            where: { id: parseInt(id) }
        });

        res.status(204).json({
            status: 'success',
            data: null
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
