const CrudFactory = require('./handlerFactory');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class PurchaseInvoiceController extends CrudFactory {
    constructor() {
        super('purchase_invoices');
    }

    create = catchAsync(async (req, res, next) => {
        const data = { ...req.body };

        // Ensure Company ID
        if (!data.company_id && req.user.company_id) {
            data.company_id = req.user.company_id;
        }

        // Initialize Payment Variables
        let shouldAddPayment = false;
        let paymentAmount = 0;
        let paymentMethod = 'Bank_Transfer'; // Default to Bank_Transfer to match Enum

        // Extract Payment Info (Frontend sends add_payment, payment_amount, etc.)
        // Extract Payment Info
        if (data.add_payment === true || data.add_payment === 'true') {
            shouldAddPayment = true;
            paymentAmount = parseFloat(data.payment_amount || 0);
            paymentMethod = data.payment_method || 'Bank_Transfer';

            // Set Invoice Status & Amount immediately for creation
            data.status = 'Paid'; // Assuming 'Paid' is valid enum, will verify in grep
            data.paid_amount = paymentAmount;
            // Balance is generated
        } else {
             data.status = 'Open'; 
             data.paid_amount = 0;
        }

        // remove non-model fields
        const isTaxInclusive = (data.is_tax_inclusive === true || data.is_tax_inclusive === 'true');
        delete data.is_tax_inclusive;
        delete data.add_payment;
        delete data.payment_amount;
        delete data.payment_method;

        console.log(`[DEBUG] PurchaseInvoiceController.create: Data:`, JSON.stringify(data));

        // 1. Fetch Warehouse (Default to Main Store)
        const warehouse = await prisma.warehouses.findFirst({
            where: { company_id: parseInt(req.user.company_id), is_active: true }
        });
        const warehouseId = warehouse ? warehouse.id : 1;

        // 2. Transaction
        const result = await prisma.$transaction(async (tx) => {
            // A. Create Purchase Invoice (and items nested if provided standard way, but we might need manual handling if structure varies)
            // Checking structure: data.purchase_invoice_items might be { create: [...] } or just [...]

            // We need to intercept items to update stock/price
            let items = [];
            if (data.purchase_invoice_items && data.purchase_invoice_items.create) {
                items = data.purchase_invoice_items.create;
            } else if (Array.isArray(data.purchase_invoice_items)) {
                items = data.purchase_invoice_items;
                // Reformat for Prisma create if it's a direct array
                data.purchase_invoice_items = { create: items };
            }

            // --- SERVER SIDE VALIDATION for Tax Inclusive ---
            // --- SERVER SIDE VALIDATION for Tax Inclusive ---
            // User Request: "Store the tax inclusive price in database"
            // So we DO NOT convert to exclusive. We save as is.
            // Items from frontend are already Inclusive (1200).
            // Subtotal from frontend should be checked.
            // ------------------------------------------------

            // Create Invoice
            const newInvoice = await tx.purchase_invoices.create({
                data: data,
                include: { purchase_invoice_items: true }
            });

            // B. Handle Payment (if applicable)
            if (shouldAddPayment && paymentAmount > 0) {
                await tx.payments_made.create({
                    data: {
                        company_id: req.user.company_id,
                        payment_number: `PAY-OUT-${Date.now()}`,
                        supplier_id: newInvoice.supplier_id,
                        payment_date: new Date(newInvoice.bill_date),
                        amount: paymentAmount,
                        payment_mode: paymentMethod,
                        notes: `Auto-payment for Bill ${newInvoice.bill_number}`,
                        created_by: req.user.id
                    }
                });
                console.log(`[DEBUG] Payment Made recorded for Bill ${newInvoice.bill_number}`);
            }

            // B. Process Items (Stock & Price Update)
            if (items.length > 0) {
                for (const item of items) {
                    const pid = parseInt(item.product_id);
                    const qty = parseFloat(item.quantity);
                    const cost = parseFloat(item.unit_price);

                    if (pid && qty) {
                        // 1. Update Product Master (Legacy Stock + New Cost Price)
                        await tx.products.update({
                            where: { id: pid },
                            data: {
                                stock: { increment: qty },
                                standard_cost: cost // Update 'Buy Price'
                            }
                        });

                        // 2. Update Stock Balance (UI Source of Truth)
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
                                where: { id: existingBalance.id },
                                data: {
                                    quantity: { increment: qty },
                                    last_updated: new Date()
                                }
                            });
                        } else {
                            await tx.stock_balance.create({
                                data: {
                                    company_id: req.user.company_id,
                                    product_id: pid,
                                    warehouse_id: warehouseId,
                                    quantity: qty,
                                    // available_quantity: qty, // Generated Column
                                    last_updated: new Date()
                                }
                            });
                        }

                        // 3. Create Stock Transaction Audit (IN)
                        try {
                            await tx.stock_transactions.create({
                                data: {
                                    company_id: req.user.company_id,
                                    transaction_type: 'IN', // Assuming IN or PURCHASE exists
                                    product_id: pid,
                                    warehouse_id: warehouseId,
                                    quantity: qty,
                                    reference_type: 'Purchase Invoice',
                                    reference_id: newInvoice.id,
                                    transaction_date: new Date(),
                                    remarks: `Purchase Invoice ${newInvoice.bill_number}`,
                                    created_by: req.user.id
                                }
                            });
                        } catch (err) {
                            console.warn(`[WARNING] Failed to log stock_transaction (IN) for product ${pid}: ${err.message}`);
                        }

                        console.log(`[DEBUG] Updated Stock & Price for Product ID ${pid}: +${qty} qty, Price=${cost}`);
                    }
                }
            }

            return newInvoice;
        });

        res.status(201).json({
            status: 'success',
            data: result
        });
    });

    update = catchAsync(async (req, res, next) => {
        // Check access
        const whereCheck = this.getWhereClause(req, { id: parseInt(req.params.id) });
        const existing = await this.model.findFirst({ where: whereCheck });

        if (!existing) {
            return next(new AppError('No document found with that ID or unauthorized', 404));
        }

        const data = { ...req.body };

        // Transform supplier_id to relation format for Prisma update
        if (data.supplier_id) {
            data.suppliers = {
                connect: { id: parseInt(data.supplier_id) }
            };
            delete data.supplier_id;
        }

        if (data.purchase_invoice_items && data.purchase_invoice_items.create) {
            // company_id is not part of purchase_invoice_items
        }

        // Remove non-model fields
        delete data.is_tax_inclusive;
        delete data.add_payment;
        delete data.payment_amount;
        delete data.payment_method;
        delete data.initial_stock;
        delete data.id;
        delete data.created_at;
        delete data.updated_at;

        console.log(`[DEBUG] PurchaseInvoiceController.update: Transformed data:`, JSON.stringify(data));

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

module.exports = new PurchaseInvoiceController();
