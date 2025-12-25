const CrudFactory = require('./handlerFactory');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class ProductController extends CrudFactory {
    constructor() {
        super('products');
    }

    // Override delete to perform Soft Delete (is_active = false)
    delete = catchAsync(async (req, res, next) => {
        const id = parseInt(req.params.id);

        // 1. Check if product exists and user has access
        const whereCheck = this.getWhereClause(req, { id });
        const existing = await this.model.findFirst({ where: whereCheck });

        if (!existing) {
            return next(new AppError('No product found with that ID or unauthorized', 404));
        }

        // 2. Perform Soft Delete update using updateMany for safety
        const { count } = await this.model.updateMany({
            where: {
                id: id,
                company_id: existing.company_id // Enforce same company
            },
            data: { is_active: false }
        });

        if (count === 0) {
            return next(new AppError('Failed to delete product', 500));
        }

        // 3. Return success (204 No Content)
        res.status(204).json({
            status: 'success',
            data: null
        });
    });

    // Handle Create with Initial Stock
    create = catchAsync(async (req, res, next) => {
        const data = { ...req.body };
        const initialStock = parseFloat(data.stock || 0);

        // Remove virtual fields if any, but keep 'stock' for legacy compatibility
        delete data.initial_stock;

        // Add Company ID if not present (usually handled by auth middleware/factory but ensuring)
        if (!data.company_id && req.query.company_id) {
            data.company_id = parseInt(req.query.company_id);
        } else if (!data.company_id && req.user.company_id) {
            data.company_id = req.user.company_id;
        }

        if (data.category_id) data.category_id = parseInt(data.category_id);
        if (data.uom_id) data.uom_id = parseInt(data.uom_id);

        const newDoc = await this.model.create({ data });

        // If Initial Stock provided, create stock balance
        if (initialStock > 0 && newDoc) {
            const warehouse = await prisma.warehouses.findFirst({
                where: { company_id: newDoc.company_id, is_active: true }
            });

            if (warehouse) {
                await prisma.stock_balance.create({
                    data: {
                        product_id: newDoc.id,
                        warehouse_id: warehouse.id,
                        quantity: initialStock,
                        // available_quantity is generated
                        reserved_quantity: 0,
                        company_id: newDoc.company_id
                    }
                });

                await prisma.stock_transactions.create({
                    data: {
                        company_id: newDoc.company_id,
                        transaction_type: 'ADJUSTMENT',
                        product_id: newDoc.id,
                        warehouse_id: warehouse.id,
                        quantity: initialStock,
                        reference_type: 'Initial Setup',
                        remarks: 'Opening Stock on Creation',
                        created_by: req.user?.id
                    }
                });
            }
        }

        res.status(201).json({
            status: 'success',
            data: newDoc
        });
    });

    // Override update to handle standard edits + stock column directly
    update = catchAsync(async (req, res, next) => {
        const id = parseInt(req.params.id);
        const data = { ...req.body };

        console.log(`[DEBUG] ProductController.update: ID=${id}, Data=`, data);

        // 1. Check if product exists and user has access
        const whereCheck = this.getWhereClause(req, { id });
        const existing = await this.model.findFirst({
            where: whereCheck,
            include: { stock_balance: true } // Fetch current balance
        });

        if (!existing) {
            return next(new AppError('No product found with that ID or unauthorized', 404));
        }

        // Handle Stock Update Logic
        if (data.stock !== undefined && data.stock !== null) {
            const newTargetStock = parseFloat(data.stock);

            // Calculate Current Total Stock
            const currentStock = existing.stock_balance.reduce((sum, sb) => sum + parseFloat(sb.quantity || 0), 0);

            const diff = newTargetStock - currentStock;

            if (Math.abs(diff) > 0.01) {
                console.log(`[STOCK] Manual Adjustment for Product ${id}. Target=${newTargetStock}, Current=${currentStock}, Diff=${diff}`);

                const warehouse = await prisma.warehouses.findFirst({
                    where: { company_id: existing.company_id, is_active: true }
                });

                if (warehouse) {
                    await prisma.stock_balance.upsert({
                        where: {
                            product_id_warehouse_id: {
                                product_id: existing.id,
                                warehouse_id: warehouse.id
                            }
                        },
                        update: {
                            quantity: { increment: diff }
                            // available_quantity is generated
                        },
                        create: {
                            product_id: existing.id,
                            warehouse_id: warehouse.id,
                            quantity: newTargetStock, // If no record, diff is effectively the target (since current=0)
                            // available_quantity is generated
                            reserved_quantity: 0,
                            company_id: existing.company_id
                        }
                    });

                    // Record Transaction
                    await prisma.stock_transactions.create({
                        data: {
                            company_id: existing.company_id,
                            transaction_type: 'ADJUSTMENT',
                            product_id: existing.id,
                            warehouse_id: warehouse.id,
                            quantity: diff,
                            reference_type: 'Manual Correction',
                            remarks: 'Manual Stock Update from Edit',
                            created_by: req.user?.id
                        }
                    });
                }
            }
        }

        // Clean up data for Product Table Update
        delete data.id;
        delete data.created_at;
        delete data.updated_at;
        delete data.stock_balance;
        delete data.initial_stock;

        if (data.category_id) data.category_id = parseInt(data.category_id);
        if (data.uom_id) data.uom_id = parseInt(data.uom_id);
        if (data.stock) data.stock = parseFloat(data.stock);

        // 2. Perform Update on Product Table
        const doc = await this.model.update({
            where: { id },
            data: data
        });

        res.status(200).json({
            status: 'success',
            data: doc
        });
    });

    // Override getAll to filter only active products by default
    getAll = catchAsync(async (req, res, next) => {
        // Enforce is_active=true unless specifically requested otherwise
        if (req.query.is_active === undefined) {
            req.query.is_active = 'true';
        }

        // --- Copied and Modified from CrudFactory.getAll to avoid super.getAll() issue ---
        // Extract query parameters for simple filtering
        const { page = 1, limit = 10, sort, search, include, ...filters } = req.query;

        const skip = (page - 1) * limit;

        // Apply multi-tenant isolation
        const where = this.getWhereClause(req, filters);

        // Apply simple search if query param exists
        if (search) {
            // Fields specific to Products
            const fieldsToSearch = ['name', 'product_code', 'sku', 'barcode'];

            if (fieldsToSearch && fieldsToSearch.length > 0) {
                // Simplified OR for search
                where.OR = fieldsToSearch.map(field => ({
                    [field]: { contains: search }
                }));
            }
        }

        // Parse include parameter if provided
        let includeObj = {};
        if (include) {
            try {
                includeObj = JSON.parse(include);
            } catch (e) {
                console.error('Failed to parse include parameter:', e);
            }
        }

        // Always include stock_balance to calculate dynamic stock
        includeObj.stock_balance = true;

        const docs = await this.model.findMany({
            where,
            skip,
            take: parseInt(limit),
            orderBy: sort ? { [sort]: 'asc' } : { id: 'desc' }, // Default sort by newest
            include: includeObj
        });

        const total = await this.model.count({ where });

        // Augment docs with computed stock
        const augmentedDocs = docs.map(doc => {
            let totalStock = 0;
            if (doc.stock_balance && doc.stock_balance.length > 0) {
                totalStock = doc.stock_balance.reduce((sum, sb) => sum + parseFloat(sb.quantity || 0), 0);
            }

            // Prefer calculated stock over legacy stock field, but keep legacy as fallback if needed?
            // User sees 'stock', so we overwrite it.
            return {
                ...doc,
                stock: totalStock, // Overwrite legacy stock
                // Optionally keep legacy if needed: _legacy_stock: doc.stock 
            };
        });

        res.status(200).json({
            status: 'success',
            results: augmentedDocs.length,
            total,
            data: augmentedDocs
        });
    });
}

module.exports = new ProductController();
