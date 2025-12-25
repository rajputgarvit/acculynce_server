const prisma = require('../prisma/client');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

// This Factory class generates CRUD handlers for any Prisma model
// It makes our API dynamic and scalable
class CrudFactory {
    constructor(modelName) {
        // modelName must match the Prisma Client model name (e.g., 'user', 'invoice')
        this.modelName = modelName;
        this.model = prisma[modelName];
        if (!this.model) {
            throw new Error(`Model ${modelName} not found in Prisma Client`);
        }
    }

    // Helper to get multi-tenant where clause
    getWhereClause(req, initialWhere = {}) {
        const isSuperAdmin = req.user?.roles?.includes('Super Admin');
        const where = { ...initialWhere };

        console.log(`[DEBUG] CrudFactory(${this.modelName}): User=${req.user?.username}, CompanyID=${req.user?.company_id}, IsSuperAdmin=${isSuperAdmin}`);

        if (!isSuperAdmin && req.user?.company_id) {
            // List of models that do not have company_id column and should not have it enforced in where clause
            const skipCompanyIsolationModels = ['customer_addresses', 'invoice_items', 'product_images'];

            if (this.modelName === 'company_settings') {
                // For company_settings, the record ID is the company_id itself for regular users
                where.id = req.user.company_id;
            } else if (['units_of_measure', 'product_categories', 'payment_methods'].includes(this.modelName)) {
                // Allow global (null) or company-specific records
                where.OR = [
                    { company_id: req.user.company_id },
                    { company_id: null }
                ];
            } else if (!skipCompanyIsolationModels.includes(this.modelName)) {
                // Default isolation: must match company_id
                where.company_id = req.user.company_id;
            }
        }
        console.log(`[DEBUG] CrudFactory(${this.modelName}): Final Where Clause:`, JSON.stringify(where));
        return where;
    }

    // Get all records with pagination and filtering
    getAll = catchAsync(async (req, res, next) => {
        // Extract query parameters for simple filtering
        // e.g. ?page=1&limit=10&city=NewYork
        const { page = 1, limit = 10, sort, search, include, ...filters } = req.query;

        const skip = (page - 1) * limit;

        // Apply multi-tenant isolation
        const where = this.getWhereClause(req, filters);

        // Apply simple search if query param exists
        if (search) {
            // Apply basic search based on common string fields
            // You'll customize this based on model
            const searchConditions = [];

            // Get model fields dynamically
            // Note: Prisma Client does not expose model fields directly via `this.model.fields`.
            // You would typically define a list of searchable fields per model or use introspection.
            // For this example, we'll use a predefined list for common models.
            const searchableFields = {
                products: ['name', 'product_code'],
                customers: ['company_name', 'contact_person', 'email', 'phone', 'customer_code'],
                // Add more models and their searchable fields here
            };

            const fieldsToSearch = searchableFields[this.modelName];

            if (fieldsToSearch && fieldsToSearch.length > 0) {
                const modelSearchConditions = fieldsToSearch.map(field => ({
                    [field]: { contains: search, mode: 'insensitive' } // 'mode: insensitive' for case-insensitive search
                }));
                where.OR = modelSearchConditions;
            }
        }

        // Parse include parameter if provided
        let includeObj = undefined;
        if (include) {
            try {
                includeObj = JSON.parse(include);
            } catch (e) {
                console.error('Failed to parse include parameter:', e);
            }
        }

        console.log(`[DEBUG] CrudFactory(${this.modelName}).getAll: Where:`, JSON.stringify(where), 'Include:', includeObj);

        const docs = await this.model.findMany({
            where,
            skip,
            take: parseInt(limit),
            orderBy: sort ? { [sort]: 'asc' } : undefined,
            include: includeObj
        });

        // Get total count for pagination info
        const total = await this.model.count({ where });

        res.status(200).json({
            status: 'success',
            results: docs.length,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / limit)
            },
            data: docs,
        });
    });

    // Get single record by ID
    getOne = catchAsync(async (req, res, next) => {
        // Apply multi-tenant isolation to the ID lookup
        const where = this.getWhereClause(req, { id: parseInt(req.params.id) });

        // Parse include parameter if provided (same as getAll)
        let includeObj = undefined;
        if (req.query.include) {
            try {
                includeObj = JSON.parse(req.query.include);
            } catch (e) {
                console.error('Failed to parse include parameter in getOne:', e);
            }
        }

        const doc = await this.model.findFirst({
            where,
            include: includeObj
        });

        if (!doc) {
            return next(new AppError('No document found with that ID or unauthorized', 404));
        }

        res.status(200).json({
            status: 'success',
            data: doc,
        });
    });

    // Create new record
    create = catchAsync(async (req, res, next) => {
        const data = { ...req.body };

        const injectCompanyId = (obj, companyId) => {
            if (Array.isArray(obj)) {
                obj.forEach(item => injectCompanyId(item, companyId));
                return;
            }
            if (typeof obj !== 'object' || obj === null) return;

            // Check if this object is a Prisma relation wrapper (key indicators)
            const isPrismaWrapper = obj.create || obj.connect || obj.connectOrCreate || obj.createMany;

            if (isPrismaWrapper) {
                // It is a wrapper, so we ONLY recurse into the data-creation parts
                // ensuring we don't inject company_id into the wrapper itself
                if (obj.create) injectCompanyId(obj.create, companyId);
                if (obj.createMany && obj.createMany.data) injectCompanyId(obj.createMany.data, companyId);
                if (obj.connectOrCreate) {
                    const targets = Array.isArray(obj.connectOrCreate) ? obj.connectOrCreate : [obj.connectOrCreate];
                    targets.forEach(t => {
                        if (t.create) injectCompanyId(t.create, companyId);
                    });
                }
            } else {
                // It's a regular data object, so inject company_id
                if (!obj.company_id) {
                    obj.company_id = companyId;
                }

                // Recurse into all values to find nested relations
                Object.entries(obj).forEach(([key, value]) => {
                    // Skip recursion for models that don't have company_id
                    // This prevents injecting company_id into nested relations like customer_addresses
                    if (['customer_addresses', 'invoice_items', 'product_images', 'customer_notes', 'purchase_invoice_items'].includes(key)) {
                        return;
                    }

                    if (typeof value === 'object' && value !== null) {
                        injectCompanyId(value, companyId);
                    }
                });
            }
        };


        // Handle Initial Stock for Products
        if (this.modelName === 'products' && data.initial_stock) {
            const initialStock = parseFloat(data.initial_stock);
            delete data.initial_stock; // Remove non-schema field

            if (initialStock > 0 && req.user?.company_id) {
                // Find default warehouse
                const warehouse = await prisma.warehouses.findFirst({
                    where: { company_id: req.user.company_id, is_active: true }
                });

                if (warehouse) {
                    data.stock_balance = {
                        create: {
                            warehouse_id: warehouse.id,
                            quantity: initialStock,
                            available_quantity: initialStock,
                            reserved_quantity: 0
                        }
                    };
                    data.stock_transactions = {
                        create: {
                            warehouse_id: warehouse.id,
                            quantity: initialStock,
                            transaction_type: 'ADJUSTMENT',
                            remarks: 'Initial Stock created with product'
                        }
                    };
                }
            }
        }

        // Handle Purchase Invoice Payment Logic
        if (this.modelName === 'purchase_invoices') {
            if (data.add_payment) {
                data.status = 'Paid';
                data.paid_amount = data.total_amount;
            } else {
                data.status = 'Draft';
            }
            delete data.add_payment;
            delete data.payment_amount;
        }

        // Auto-inject company_id if user is not Super Admin
        const isSuperAdmin = req.user?.roles?.includes('Super Admin');
        // Models that do not have company_id column and should not have it injected
        const skipCompanyInjectionModels = ['customer_addresses', 'invoice_items', 'product_images'];

        if (!isSuperAdmin && req.user?.company_id && this.modelName !== 'company_settings' && !skipCompanyInjectionModels.includes(this.modelName)) {
            data.company_id = req.user.company_id;
            // Recursively inject for nested writes (e.g. invoice_items, payments)
            injectCompanyId(data, req.user.company_id);
            console.log(`[DEBUG] CrudFactory(${this.modelName}): Injected company_id=${data.company_id} (recursively)`);
        }

        const doc = await this.model.create({
            data,
        });

        // Handle Stock Update for Purchase Invoices
        if (this.modelName === 'purchase_invoices') {
            const items = data.purchase_invoice_items?.create;
            if (items && Array.isArray(items) && items.length > 0) {
                try {
                    // Find default warehouse for the company
                    const warehouse = await prisma.warehouses.findFirst({
                        where: { company_id: data.company_id, is_active: true }
                    });

                    if (warehouse) {
                        for (const item of items) {
                            const qty = parseFloat(item.quantity) || 0;
                            if (qty > 0) {
                                // Update Stock Balance (Upsert)
                                await prisma.stock_balance.upsert({
                                    where: {
                                        product_id_warehouse_id: {
                                            product_id: item.product_id,
                                            warehouse_id: warehouse.id
                                        }
                                    },
                                    update: {
                                        quantity: { increment: qty }
                                        // available_quantity is generated
                                    },
                                    create: {
                                        product_id: item.product_id,
                                        warehouse_id: warehouse.id,
                                        quantity: qty,
                                        // available_quantity is generated
                                        reserved_quantity: 0,
                                        company_id: data.company_id
                                    }
                                });

                                // Create Stock Transaction
                                await prisma.stock_transactions.create({
                                    data: {
                                        company_id: data.company_id,
                                        transaction_type: 'PURCHASE',
                                        product_id: item.product_id,
                                        warehouse_id: warehouse.id,
                                        quantity: qty,
                                        reference_type: 'Purchase Invoice',
                                        reference_id: doc.id, // Using the ID from the created document
                                        remarks: `Purchase Bill ${doc.bill_number}`,
                                        created_by: req.user?.id
                                    }
                                });
                            }
                        }
                    } else {
                        console.warn(`[WARN] No active warehouse found for company ${data.company_id}. Stock not updated.`);
                    }
                } catch (stockError) {
                    console.error('[ERROR] Failed to update stock for purchase:', stockError);
                    // We don't fail the request because the invoice was created, but we log the error
                }
            }
        }

        res.status(201).json({
            status: 'success',
            data: doc,
        });
    });

    // Update record
    update = catchAsync(async (req, res, next) => {
        // First check if user has access to this record
        const whereCheck = this.getWhereClause(req, { id: parseInt(req.params.id) });
        const existing = await this.model.findFirst({ where: whereCheck });

        if (!existing) {
            return next(new AppError('No document found with that ID or unauthorized', 404));
        }

        const data = { ...req.body };
        // Remove virtual fields not in schema
        delete data.initial_stock;
        delete data.id; // Prevent updating ID
        delete data.created_at;
        delete data.updated_at;

        // Ensure foreign keys are integers or null (Prisma strictness)
        if (data.category_id) data.category_id = parseInt(data.category_id);
        if (data.uom_id) data.uom_id = parseInt(data.uom_id);

        console.log(`[DEBUG] CrudFactory(${this.modelName}).update: Payload:`, JSON.stringify(data));

        const doc = await this.model.update({
            where: { id: parseInt(req.params.id) },
            data,
        });

        res.status(200).json({
            status: 'success',
            data: doc,
        });
    });

    // Delete record
    delete = catchAsync(async (req, res, next) => {
        // First check if user has access to this record
        const whereCheck = this.getWhereClause(req, { id: parseInt(req.params.id) });

        // If deleting purchase invoice, include items to reverse stock
        const include = this.modelName === 'purchase_invoices' ? { purchase_invoice_items: true } : undefined;

        const existing = await this.model.findFirst({
            where: whereCheck,
            include
        });

        if (!existing) {
            return next(new AppError('No document found with that ID or unauthorized', 404));
        }

        // Handle Stock Reversal for Purchase Invoices
        if (this.modelName === 'purchase_invoices' && existing.purchase_invoice_items && existing.purchase_invoice_items.length > 0) {
            console.log(`[STOCK] Reversing stock for Deleted Purchase #${existing.bill_number}`);
            try {
                const warehouse = await prisma.warehouses.findFirst({
                    where: { company_id: existing.company_id, is_active: true }
                });

                if (warehouse) {
                    for (const item of existing.purchase_invoice_items) {
                        const qty = parseFloat(item.quantity) || 0;
                        if (qty > 0) {
                            // Reverse Stock Balance (Decrement)
                            await prisma.stock_balance.upsert({
                                where: {
                                    product_id_warehouse_id: {
                                        product_id: item.product_id,
                                        warehouse_id: warehouse.id
                                    }
                                },
                                update: {
                                    quantity: { decrement: qty }
                                    // available_quantity is generated
                                },
                                create: {
                                    // Should not happen for reversal usually, but safe fallback (negative stock?)
                                    // Actually if we delete a purchase, we remove stock. If stock goes negative, let it be?
                                    // Prisma create doesn't support decrement. We just set 0 or negative.
                                    product_id: item.product_id,
                                    warehouse_id: warehouse.id,
                                    quantity: -qty,
                                    // available_quantity is generated
                                    reserved_quantity: 0,
                                    company_id: existing.company_id
                                }
                            });

                            // Create Reversal Transaction
                            await prisma.stock_transactions.create({
                                data: {
                                    company_id: existing.company_id,
                                    transaction_type: 'ADJUSTMENT', // Or 'PURCHASE_RETURN' if enum supports it. Defaulting to Adjustment or Purchase with negative qty
                                    product_id: item.product_id,
                                    warehouse_id: warehouse.id,
                                    quantity: -qty, // Negative quantity
                                    reference_type: 'Purchase Invoice Delete',
                                    reference_id: existing.id,
                                    remarks: `Reversal: Voided Purchase Bill ${existing.bill_number}`,
                                    created_by: req.user?.id
                                }
                            });
                        }
                    }
                }
            } catch (err) {
                console.error(`[ERROR] Failed to reverse stock for purchase ${existing.id}:`, err);
                // We proceed with deletion even if stock reversal fails (to avoid stuck records), but logging is critical
            }
        }

        await this.model.delete({
            where: { id: parseInt(req.params.id) },
        });

        res.status(204).json({
            status: 'success',
            data: null,
        });
    });
}

module.exports = CrudFactory;
