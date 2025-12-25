const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

exports.getGSTR1 = catchAsync(async (req, res, next) => {
    const { startDate, endDate, company_id } = req.query;

    if (!startDate || !endDate) {
        return next(new AppError('Please provide start and end dates', 400));
    }

    const invoices = await prisma.invoices.findMany({
        where: {
            company_id: parseInt(company_id),
            invoice_date: {
                gte: new Date(startDate),
                lte: new Date(endDate),
            },
            status: {
                not: 'Cancelled'
            }
        },
        include: {
            customers: {
                include: {
                    customer_addresses: true
                }
            },
            invoice_items: true
        }
    });

    // Process data for GSTR-1 format
    // Group by B2B, B2C Large, B2C Small
    const b2b = [];
    const b2cLarge = []; // Inter-state > 2.5 Lakhs
    const b2cSmall = [];

    const companySettings = await prisma.company_settings.findUnique({
        where: { id: parseInt(company_id) }
    });
    const companyState = companySettings?.state || '';

    invoices.forEach(inv => {
        const isRegistered = inv.customers.gstin && inv.customers.gstin.length > 0;
        const total = parseFloat(inv.total_amount);
        const taxable = parseFloat(inv.subtotal); // Simplified
        const tax = parseFloat(inv.tax_amount);

        const row = {
            invoice_number: inv.invoice_number,
            invoice_date: inv.invoice_date,
            customer_name: inv.customers.company_name,
            gstin: inv.customers.gstin,
            state: inv.customers.customer_addresses?.[0]?.state || '',
            taxable_value: taxable,
            tax_amount: tax,
            total_amount: total,
        };

        if (isRegistered) {
            b2b.push(row);
        } else {
            // B2C Large Logic: Inter-state AND > 2.5 Lakhs
            const custState = row.state;
            let isInterState = false;

            if (custState && companyState) {
                isInterState = custState.trim().toLowerCase() !== companyState.trim().toLowerCase();
            }

            if (isInterState && total > 250000) {
                b2cLarge.push(row);
            } else {
                b2cSmall.push(row);
            }
        }
    });

    res.status(200).json({
        status: 'success',
        data: {
            b2b,
            b2cLarge,
            b2cSmall,
            summary: {
                total_invoices: invoices.length,
                total_taxable: invoices.reduce((sum, inv) => sum + Number(inv.subtotal), 0),
                total_tax: invoices.reduce((sum, inv) => sum + Number(inv.tax_amount), 0),
                total_value: invoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0)
            }
        }
    });
});

exports.getGSTR2 = catchAsync(async (req, res, next) => {
    const { startDate, endDate, company_id } = req.query;

    const purchases = await prisma.purchase_invoices.findMany({
        where: {
            company_id: parseInt(company_id),
            bill_date: {
                gte: new Date(startDate),
                lte: new Date(endDate),
            },

        },
        include: {
            suppliers: {
                include: {
                    supplier_addresses: true
                }
            }
        }
    });

    const b2b = purchases.map(bill => ({
        bill_number: bill.bill_number,
        bill_date: bill.bill_date,
        supplier_name: bill.suppliers.company_name,
        gstin: bill.suppliers.gstin,
        state: bill.suppliers.supplier_addresses?.[0]?.state || '',
        taxable_value: parseFloat(bill.subtotal),
        tax_amount: parseFloat(bill.tax_amount),
        total_amount: parseFloat(bill.total_amount)
    }));

    res.status(200).json({
        status: 'success',
        data: {
            b2b,
            summary: {
                total_bills: purchases.length,
                total_taxable: purchases.reduce((sum, bill) => sum + Number(bill.subtotal), 0),
                total_tax: purchases.reduce((sum, bill) => sum + Number(bill.tax_amount), 0),
                total_value: purchases.reduce((sum, bill) => sum + Number(bill.total_amount), 0)
            }
        }
    });
});

exports.getGSTR3B = catchAsync(async (req, res, next) => {
    const { startDate, endDate, company_id } = req.query;
    // Re-use logic or separate aggregation for 3B
    // 3.1 Tax on outward supplies (Sales)
    // 4. Eligible ITC (Purchases)

    const salesAgg = await prisma.invoices.aggregate({
        where: {
            company_id: parseInt(company_id),
            invoice_date: { gte: new Date(startDate), lte: new Date(endDate) },
            status: { not: 'Cancelled' }
        },
        _sum: {
            subtotal: true,
            tax_amount: true,
            total_amount: true
        }
    });

    const purchaseAgg = await prisma.purchase_invoices.aggregate({
        where: {
            company_id: parseInt(company_id),
            bill_date: { gte: new Date(startDate), lte: new Date(endDate) },

        },
        _sum: {
            subtotal: true,
            tax_amount: true, // This is roughly ITC available
            total_amount: true
        }
    });

    res.status(200).json({
        status: 'success',
        data: {
            outward_supplies: {
                taxable_value: salesAgg._sum.subtotal || 0,
                tax_amount: salesAgg._sum.tax_amount || 0,
                total_value: salesAgg._sum.total_amount || 0
            },
            itc_available: {
                taxable_value: purchaseAgg._sum.subtotal || 0,
                tax_amount: purchaseAgg._sum.tax_amount || 0,
                total_value: purchaseAgg._sum.total_amount || 0
            },
            tax_payable: (salesAgg._sum.tax_amount || 0) - (purchaseAgg._sum.tax_amount || 0)
        }
    });
});

exports.getProfitLoss = catchAsync(async (req, res, next) => {
    const { startDate, endDate, company_id } = req.query;
    const cId = parseInt(company_id);

    // 1. Income (Sales)
    const sales = await prisma.invoices.aggregate({
        where: {
            company_id: cId,
            invoice_date: { gte: new Date(startDate), lte: new Date(endDate) },
            status: { not: 'Cancelled' }
        },
        _sum: { subtotal: true } // Revenue is typically without tax
    });
    const totalRevenue = Number(sales._sum.subtotal || 0);

    // 2. COGS (Purchases) - Opening Stock + Purchases - Closing Stock (Simplification: Just Purchases for now or assuming sold everything? Standard P&L usually tracks Purchases)
    // For a trading business, Purchases is the main direct expense.
    const purchases = await prisma.purchase_invoices.aggregate({
        where: {
            company_id: cId,
            bill_date: { gte: new Date(startDate), lte: new Date(endDate) },

        },
        _sum: { subtotal: true }
    });
    const totalPurchases = Number(purchases._sum.subtotal || 0);

    // 3. Closing Stock Calculation
    // Value of current unsold stock. (Simplified: Using current Master stock value. Ideally should be historical based on endDate).
    const products = await prisma.products.findMany({
        where: { company_id: cId },
        select: { stock: true, standard_cost: true, selling_price: true, product_type: true, name: true }
    });
    console.log(`[DEBUG] P&L Closing Stock: Found ${products.length} products for Company ${cId}`);
    if (products.length > 0) {
        console.log(`[DEBUG] Sample Product:`, JSON.stringify(products[0]));
    }

    // Calculate stock value. Prefer standard_cost (Purchase Price), fallback to selling_price * 0.7? No, standard_cost is safer.
    // If standard_cost is 0, it might be an issue.
    const totalClosingStock = products.reduce((sum, p) => {
        if (p.product_type === 'Service') return sum; // Services don't have stock value
        const qty = Number(p.stock || 0);
        const cost = Number(p.standard_cost || 0);
        // If cost is 0, maybe fallback to standard_cost?
        return sum + (qty * cost);
    }, 0);
    console.log(`[DEBUG] P&L Closing Stock Total: ${totalClosingStock}`);

    // 4. Gross Profit
    // Equation: Sales + Closing Stock - Purchases (Assuming Opening Stock = 0 for simplified view)
    const grossProfit = (totalRevenue + totalClosingStock) - totalPurchases;

    // 5. Indirect Expenses
    // Payroll
    const payrollCost = await prisma.payroll.aggregate({
        where: {
            employees: { company_id: cId },
            created_at: { gte: new Date(startDate), lte: new Date(endDate) }
        },
        _sum: { gross_salary: true }
    });

    const totalPayroll = Number(payrollCost._sum.gross_salary || 0);
    const totalIndirectExpenses = totalPayroll;

    // 6. Net Profit
    const netProfit = grossProfit - totalIndirectExpenses;

    res.status(200).json({
        status: 'success',
        data: {
            income: {
                sales: totalRevenue,
                closing_stock: totalClosingStock,
                total: totalRevenue + totalClosingStock,
                debug_count: products.length,
                debug_val: totalClosingStock
            },
            expenses: {
                purchases: totalPurchases,
                direct_total: totalPurchases
            },
            gross_profit: grossProfit,
            indirect_expenses: {
                payroll: totalPayroll,
                total: totalIndirectExpenses
            },
            net_profit: netProfit
        }
    });
});
