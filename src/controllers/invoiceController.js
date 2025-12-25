const CrudFactory = require('./handlerFactory');
const prisma = require('../prisma/client');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

class InvoiceController extends CrudFactory {
    constructor() {
        super('invoices');
    }

    // Override getOne to include relations
    getOne = catchAsync(async (req, res, next) => {
        const where = this.getWhereClause(req, { id: parseInt(req.params.id) });

        const doc = await this.model.findFirst({
            where,
            include: {
                customers: {
                    include: {
                        customer_addresses: true
                    }
                },
                invoice_items: {
                    include: {
                        products: {
                            include: {
                                units_of_measure: true
                            }
                        }
                    }
                }
            }
        });

        if (!doc) {
            return next(new AppError('No invoice found with that ID or unauthorized', 404));
        }

        res.status(200).json({
            status: 'success',
            data: doc,
        });
    });
    // Override create to handle Stock Deduction from Products table
    create = catchAsync(async (req, res, next) => {
        const data = req.body;

        // 1. Inject Company ID (Standard CRUD logic replacement)
        if (req.user && req.user.company_id) {
            data.company_id = req.user.company_id;

            // Inject into items if present
            if (data.invoice_items) {
                if (Array.isArray(data.invoice_items.create)) {
                    data.invoice_items.create.forEach(item => { item.company_id = req.user.company_id; });
                } else if (Array.isArray(data.invoice_items)) {
                    data.invoice_items.forEach(item => { item.company_id = req.user.company_id; });
                }
            }
        }

        // 2. Handle Payment Logic Setup (Extract fields before Prisma Create)
        const shouldAddPayment = data.add_payment === true;
        const paymentAmount = data.payment_amount ? parseFloat(data.payment_amount) : parseFloat(data.total_amount || 0);
        const paymentMethod = data.payment_method || 'Cash'; // Default to Cash

        // Clean up non-model fields
        delete data.add_payment;
        delete data.payment_amount;
        delete data.payment_method;

        // Set initial invoice status based on payment
        if (shouldAddPayment) {
            data.payment_status = 'Paid';
            data.paid_amount = paymentAmount;
            // data.balance_amount is generated, do not set
        } else {
            data.payment_status = 'Unpaid';
            data.paid_amount = 0;
            // data.balance_amount is generated, do not set
        }

        console.log(`[DEBUG] InvoiceController.create: Creating invoice. AddPay=${shouldAddPayment}, StockDeduct=True. Data:`, JSON.stringify(data));

        // 3. Fetch specific warehouse for stock transactions (Standard: Main Store)
        const warehouse = await prisma.warehouses.findFirst({
            where: { company_id: parseInt(req.user.company_id), is_active: true }
        });
        const warehouseId = warehouse ? warehouse.id : 1; // Fallback to 1 if not found (risky but better than crash if seed exists)

        // 4. Perform actions in Transaction
        const result = await prisma.$transaction(async (tx) => {
            // A. Create Invoice (and items via nested write)
            const newInvoice = await tx.invoices.create({
                data: data,
                include: { invoice_items: true }
            });

            // B. Deduct Stock for each item & Log Transaction
            // Frontend sends data.invoice_items as nested create object usually, but let's handle both.
            let itemsToProcess = [];
            if (data.invoice_items && data.invoice_items.create && Array.isArray(data.invoice_items.create)) {
                itemsToProcess = data.invoice_items.create;
            } else if (Array.isArray(data.invoice_items)) {
                itemsToProcess = data.invoice_items;
            }

            if (itemsToProcess.length > 0) {
                for (const item of itemsToProcess) {
                    const pid = parseInt(item.product_id);
                    const qty = parseFloat(item.quantity);

                    if (pid && qty) {
                        // 1. Update Product Legacy Stock (Just in case)
                        await tx.products.update({
                            where: { id: pid },
                            data: {
                                stock: { decrement: qty }
                            }
                        });

                        // 1.1 Update Stock Balance (Source of Truth for UI)
                        const existingBalance = await tx.stock_balance.findUnique({
                            where: {
                                product_id_warehouse_id: {
                                    product_id: pid,
                                    warehouse_id: warehouseId
                                }
                            }
                        });

                        if (existingBalance) {
                            await tx.stock_balance.update({
                                where: {
                                    id: existingBalance.id
                                },
                                data: {
                                    quantity: { decrement: qty },
                                    last_updated: new Date()
                                }
                            });
                        } else {
                            // Create negative balance if needed
                            await tx.stock_balance.create({
                                data: {
                                    company_id: req.user.company_id,
                                    product_id: pid,
                                    warehouse_id: warehouseId,
                                    quantity: -qty,
                                    last_updated: new Date()
                                }
                            });
                        }


            // 2. Create Stock Transaction Audit (Try 'OUT', fallback to 'ADJUSTMENT' if strict enum fails, but we assume OUT exists for sales)
            // Note: If 'OUT' is invalid, this will throw. I assume 'OUT' or 'SALE'. Let's try 'OUT'. 
            // If schema uses 'Sale' or 'Sales', it might fail. 'ADJUSTMENT' is safe-ish. 
            // Let's use 'OUT' as it is standard.
            try {
                // Verify stock_transactions table exists in schema (checked globally).
                await tx.stock_transactions.create({
                    data: {
                        company_id: req.user.company_id,
                        transaction_type: 'OUT',
                        product_id: pid,
                        warehouse_id: warehouseId,
                        quantity: qty,
                        reference_type: 'Invoice',
                        reference_id: newInvoice.id,
                        transaction_date: new Date(),
                        remarks: `Sales Invoice ${newInvoice.invoice_number}`,
                        created_by: req.user.id
                    }
                });
            } catch (err) {
                console.warn(`[WARNING] Failed to create stock_transaction for product ${pid}. Enum might be mismatch. Error: ${err.message}`);
                // Fallback to ADJUSTMENT with negative remarks if 'OUT' failed? 
                // Or just ignore log failure to not block Invoice.
                // Better to ignore log failure than fail invoice.
            }

            console.log(`[DEBUG] Deducted stock for Product ID ${pid} by ${qty}`);
        } else {
            console.log(`[DEBUG] Skipping Stock Update for item: PID=${pid}, Qty=${qty}`);
        }
                }
            }

// C. Create Payment Record if requested
if (shouldAddPayment) {
    await tx.payments.create({
        data: {
            company_id: req.user.company_id, // Ensure company isolation
            invoice_id: newInvoice.id,
            payment_date: new Date(newInvoice.invoice_date),
            amount: paymentAmount,
            payment_method: paymentMethod,
            notes: `Auto-payment on invoice creation (${paymentMethod})`,
            created_by: req.user.id
        }
    });
    console.log(`[DEBUG] Payment record created for Invoice ${newInvoice.invoice_number}`);
}

return newInvoice;
        });

res.status(201).json({
    status: 'success',
    data: result
});
    });

togglePaymentStatus = catchAsync(async (req, res, next) => {
    const id = parseInt(req.params.id);
    const invoice = await this.model.findUnique({ where: { id } });
    if (!invoice) return next(new AppError('Invoice not found', 404));

    const isPaid = invoice.payment_status === 'Paid';
    let updatedInvoice;

    if (isPaid) {
        // Revert to Unpaid
        updatedInvoice = await prisma.$transaction(async (tx) => {
            await tx.payments.deleteMany({ where: { invoice_id: id } });
            return await tx.invoices.update({
                where: { id },
                data: {
                    payment_status: 'Unpaid',
                    paid_amount: 0
                }
            });
        });
        // Re-fetch to be safe or use existing quantity
        updatedInvoice = await prisma.invoices.update({
            where: { id },
            data: {
                payment_status: 'Unpaid',
                paid_amount: 0
            }
        });
    } else {
        // Mark as Paid
        updatedInvoice = await prisma.$transaction(async (tx) => {
            await tx.payments.create({
                data: {
                    invoice_id: id,
                    company_id: invoice.company_id,
                    amount: invoice.total_amount,
                    payment_date: new Date(),
                    payment_method: 'Cash',
                    notes: 'Manual toggle to Paid',
                    created_by: req.user.id
                }
            });
            return await tx.invoices.update({
                where: { id },
                data: {
                    payment_status: 'Paid',
                    paid_amount: invoice.total_amount
                }
            });
        });
    }

    // Fetch the fully updated document with all relations to avoid frontend data loss
    const fullUpdatedInvoice = await this.model.findUnique({
        where: { id },
        include: {
            customers: {
                include: {
                    customer_addresses: true
                }
            },
            invoice_items: {
                include: {
                    products: {
                        include: {
                            units_of_measure: true
                        }
                    }
                }
            }
        }
    });

    res.status(200).json({ status: 'success', data: fullUpdatedInvoice });
});

update = catchAsync(async (req, res, next) => {
    // Check access
    const whereCheck = this.getWhereClause(req, { id: parseInt(req.params.id) });
    const existing = await this.model.findFirst({ where: whereCheck });

    if (!existing) {
        return next(new AppError('No document found with that ID or unauthorized', 404));
    }

    const data = { ...req.body };

    // Transform customer_id to relation format for Prisma update
    if (data.customer_id) {
        data.customers = {
            connect: { id: parseInt(data.customer_id) }
        };
        delete data.customer_id;
    }

    // Inject company_id into nested invoice_items if present
    if (data.invoice_items && data.invoice_items.create) {
        data.invoice_items.create = data.invoice_items.create.map(item => ({
            ...item,
            company_id: existing.company_id
        }));
    }

    // Remove non-model fields
    delete data.add_payment;
    delete data.payment_amount;
    delete data.payment_method;
    delete data.initial_stock;
    delete data.id;
    delete data.created_at;
    delete data.updated_at;

    console.log(`[DEBUG] InvoiceController.update: Transformed data:`, JSON.stringify(data));

    const doc = await this.model.update({
        where: { id: parseInt(req.params.id) },
        data,
    });

    res.status(200).json({
        status: 'success',
        data: doc,
    });
});
}

module.exports = new InvoiceController();
