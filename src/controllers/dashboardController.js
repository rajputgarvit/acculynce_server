const prisma = require('../prisma/client');
const catchAsync = require('../utils/catchAsync');

class DashboardController {
    getDashboardStats = catchAsync(async (req, res, next) => {
        try {
            console.log('Dashboard stats requested by user:', req.user?.id, 'Company:', req.user?.company_id);
            const companyId = req.user.company_id;

            if (!companyId) {
                throw new Error('Company ID not found in request');
            }

            // 1. Calculate Total Revenue (Total Paid Amount from all valid invoices)
            // Updated: Sum of 'paid_amount' for all non-cancelled invoices
            const totalRevenue = await prisma.invoices.aggregate({
                where: {
                    company_id: companyId,
                    status: { not: 'Cancelled' }
                },
                _sum: {
                    paid_amount: true
                }
            });

            // 2. Calculate Receivables (Unpaid + Draft Invoices)
            // Updated: Include Drafts, exclude Cancelled, sum balance_amount
            const receivables = await prisma.invoices.aggregate({
                where: {
                    company_id: companyId,
                    status: { not: 'Cancelled' },
                    balance_amount: { gt: 0 }
                },
                _sum: {
                    balance_amount: true
                }
            });

            // 3. Calculate Payables (Unpaid Purchase Invoices)
            const payables = await prisma.purchase_invoices.aggregate({
                where: {
                    company_id: companyId,
                    balance_amount: { gt: 0 }
                },
                _sum: {
                    balance_amount: true
                }
            });

            // 4. Calculate Cash Balance
            const cashBalance = await prisma.payments_received.aggregate({
                where: {
                    company_id: companyId
                },
                _sum: {
                    amount: true
                }
            });

            // 5. Invoice Status Counts
            const invoiceStatusCounts = await prisma.invoices.groupBy({
                by: ['payment_status'],
                where: {
                    company_id: companyId,
                    status: { not: 'Draft' }
                },
                _count: {
                    id: true
                }
            });

            const statusData = invoiceStatusCounts.map(item => ({
                name: item.payment_status,
                value: item._count.id,
                color: item.payment_status === 'Paid' ? '#10b981' :
                    item.payment_status === 'Partially_Paid' ? '#f59e0b' :
                        item.payment_status === 'Unpaid' ? '#ef4444' : '#3b82f6'
            }));

            // 6. Overdue Invoices
            const overdueInvoices = await prisma.invoices.findMany({
                where: {
                    company_id: companyId,
                    status: { not: 'Cancelled' },
                    due_date: { lt: new Date() },
                    balance_amount: { gt: 0 }
                },
                take: 5,
                orderBy: { due_date: 'asc' },
                include: {
                    customers: {
                        select: { company_name: true, contact_person: true }
                    }
                }
            });

            // 7. Low Stock Items (Below 10)
            const lowStockItems = await prisma.products.findMany({
                where: {
                    company_id: companyId,
                    is_active: true,
                    stock: { lt: 10 }
                },
                take: 5,
                orderBy: { stock: 'asc' }
            });

            const formattedOverdue = overdueInvoices.map(inv => ({
                id: inv.id,
                invoiceNumber: inv.invoice_number,
                customer: inv.customers?.company_name || inv.customers?.contact_person || 'Unknown',
                dueDate: inv.due_date ? inv.due_date.toLocaleDateString('en-GB') : 'N/A',
                amount: Number(inv.balance_amount).toFixed(2),
                daysOverdue: inv.due_date
                    ? Math.floor((new Date() - new Date(inv.due_date)) / (1000 * 60 * 60 * 24))
                    : 0
            }));

            const formattedLowStock = lowStockItems.map(item => ({
                id: item.id,
                name: item.product_name,
                code: item.product_code,
                stock: Number(item.stock),
                reorderLevel: Number(item.reorder_level)
            }));

            // 8. Recent Transactions
            const recentInvoices = await prisma.invoices.findMany({
                where: {
                    company_id: companyId
                },
                include: {
                    customers: {
                        select: {
                            company_name: true,
                            contact_person: true
                        }
                    }
                },
                orderBy: {
                    created_at: 'desc'
                },
                take: 5
            });

            const formattedRecentTransactions = recentInvoices.map(inv => ({
                id: inv.id,
                invoiceNumber: inv.invoice_number,
                customer: inv.customers?.company_name || inv.customers?.contact_person || 'Unknown',
                date: inv.invoice_date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
                amount: Number(inv.total_amount).toFixed(2),
                status: inv.payment_status
            }));

            const stats = {
                totalRevenue: Number(totalRevenue._sum.paid_amount || 0),
                receivables: Number(receivables._sum.balance_amount || 0),
                payables: Number(payables._sum.balance_amount || 0),
                cashBalance: Number(cashBalance._sum.amount || 0)
            };

            res.status(200).json({
                status: 'success',
                data: {
                    stats,
                    charts: {
                        statusData
                    },
                    recentInvoices: formattedRecentTransactions,
                    overdueInvoices: formattedOverdue,
                    lowStockItems: formattedLowStock
                }
            });
        } catch (error) {
            console.error('Error in getDashboardStats:', error);
            next(error);
        }
    });
}

module.exports = new DashboardController();
