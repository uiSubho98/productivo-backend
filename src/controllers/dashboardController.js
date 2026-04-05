import Invoice from '../models/Invoice.js';
import Client from '../models/Client.js';
import Task from '../models/Task.js';
import Project from '../models/Project.js';
import Meeting from '../models/Meeting.js';
import { getSuperadminOrgIds } from '../middleware/auth.js';

export const getStats = async (req, res) => {
  try {
    // product_owner has no org data — dashboard is for org members only
    if (req.user.role === 'product_owner') {
      return res.status(403).json({ success: false, error: 'Product owner does not have an org dashboard.' });
    }

    const orgIds = await getSuperadminOrgIds(req.user);
    if (!orgIds || orgIds.length === 0) {
      return res.status(403).json({ success: false, error: 'No organization access.' });
    }

    const orgFilter = { organizationId: { $in: orgIds } };

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const [invoices, clients, tasks, projects, meetings] = await Promise.all([
      Invoice.find(orgFilter).select('total status paymentStatus taxAmount subtotal createdAt payments'),
      Client.find(orgFilter).select('pipelineStage createdAt'),
      Task.find(orgFilter).select('status priority dueDate createdAt'),
      Project.find(orgFilter).select('status createdAt'),
      Meeting.find(orgFilter).select('status scheduledAt meetingType'),
    ]);

    // Invoice metrics — exclude cancelled invoices from all stats
    const activeInvoices = invoices.filter((i) => i.status !== 'cancelled');

    const paidInvoices = activeInvoices.filter((i) => i.paymentStatus === 'paid');
    const partialInvoices = activeInvoices.filter((i) => i.paymentStatus === 'partial');
    const unpaidInvoices = activeInvoices.filter((i) => i.paymentStatus === 'unpaid');
    const overdueInvoices = activeInvoices.filter((i) => {
      if (i.paymentStatus === 'paid') return false;
      return i.status === 'overdue';
    });

    const totalRevenue = activeInvoices.reduce((sum, inv) => {
      const paid = inv.payments?.reduce((s, p) => s + (p.amount || 0), 0) || 0;
      return sum + paid;
    }, 0);

    const totalDue = activeInvoices
      .filter((i) => i.paymentStatus !== 'paid')
      .reduce((sum, inv) => {
        const paid = inv.payments?.reduce((s, p) => s + (p.amount || 0), 0) || 0;
        return sum + Math.max(0, inv.total - paid);
      }, 0);

    const thisMonthInvoices = activeInvoices.filter(
      (i) => new Date(i.createdAt) >= startOfMonth
    );
    const thisMonthRevenue = thisMonthInvoices.reduce((sum, inv) => {
      const paid = inv.payments?.reduce((s, p) => s + (p.amount || 0), 0) || 0;
      return sum + paid;
    }, 0);
    const thisMonthBilled = thisMonthInvoices.reduce((sum, i) => sum + i.total, 0);

    const lastMonthInvoices = activeInvoices.filter((i) => {
      const d = new Date(i.createdAt);
      return d >= startOfLastMonth && d <= endOfLastMonth;
    });
    const lastMonthRevenue = lastMonthInvoices.reduce((sum, inv) => {
      const paid = inv.payments?.reduce((s, p) => s + (p.amount || 0), 0) || 0;
      return sum + paid;
    }, 0);

    // Client pipeline metrics
    const clientsByStage = {};
    clients.forEach((c) => {
      const s = c.pipelineStage || 'lead';
      clientsByStage[s] = (clientsByStage[s] || 0) + 1;
    });

    // Task metrics
    const tasksByStatus = { todo: 0, in_progress: 0, done: 0, completed: 0 };
    tasks.forEach((t) => { tasksByStatus[t.status] = (tasksByStatus[t.status] || 0) + 1; });
    const overdueTasks = tasks.filter((t) => {
      if (t.status === 'done' || t.status === 'completed') return false;
      return t.dueDate && new Date(t.dueDate) < now;
    }).length;

    // Monthly invoice data for chart (last 6 months)
    const monthlyData = [];
    for (let i = 5; i >= 0; i--) {
      const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const mInvoices = activeInvoices.filter((inv) => {
        const d = new Date(inv.createdAt);
        return d >= mStart && d <= mEnd;
      });
      const billed = mInvoices.reduce((sum, inv) => sum + inv.total, 0);
      const collected = mInvoices.reduce((sum, inv) => {
        return sum + (inv.payments?.reduce((s, p) => s + (p.amount || 0), 0) || 0);
      }, 0);
      monthlyData.push({
        month: mStart.toLocaleString('en-IN', { month: 'short', year: '2-digit' }),
        billed,
        collected,
        count: mInvoices.length,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        invoices: {
          total: activeInvoices.length,
          paid: paidInvoices.length,
          partial: partialInvoices.length,
          unpaid: unpaidInvoices.length,
          overdue: overdueInvoices.length,
          totalRevenue,
          totalDue,
          thisMonthBilled,
          thisMonthRevenue,
          lastMonthRevenue,
          monthly: monthlyData,
        },
        clients: {
          total: clients.length,
          byStage: clientsByStage,
          converted: clientsByStage['converted'] || 0,
          lost: clientsByStage['lost'] || 0,
        },
        tasks: {
          total: tasks.length,
          byStatus: tasksByStatus,
          overdue: overdueTasks,
          pending: (tasksByStatus['todo'] || 0) + (tasksByStatus['in_progress'] || 0),
          done: (tasksByStatus['done'] || 0) + (tasksByStatus['completed'] || 0),
        },
        projects: {
          total: projects.length,
          active: projects.filter((p) => p.status === 'active' || p.status === 'in_progress').length,
          completed: projects.filter((p) => p.status === 'completed' || p.status === 'done').length,
        },
        meetings: {
          total: meetings.length,
          upcoming: meetings.filter((m) => m.status !== 'cancelled' && new Date(m.scheduledAt) > now).length,
        },
      },
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch dashboard stats.' });
  }
};
