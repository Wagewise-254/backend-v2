import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { cleanupExpiredCodes } from './utils/cleanupJobs.js';
import { 
  checkPayrollNotifications, 
  checkContractExpirations,
  checkMissingEmployeeDetails,
  cleanupOldNotifications 
} from './jobs/notificationJobs.js';
import workspaceRouters from './routes/workspaceRoutes.js';
import companyRoutes from './routes/companyRoutes.js';
import companyUsersRoutes from './routes/companyUsersRoutes.js';
import bankRoutes from './routes/bankRoutes.js';
import employeesRoutes from './routes/employeesRoutes.js';
import allowanceRoutes from './routes/allowanceRoutes.js';
import helbRoutes from './routes/helbRoutes.js';
import deductionRoutes from './routes/deductionRoutes.js';
import deductionTypeRoutes from './routes/deductionTypeRoutes.js';
import allowanceTypeRoutes from './routes/allowanceTypeRoutes.js';
import absentDaysRoutes from './routes/absentDaysRoutes.js';
import companyReviewersRoutes from './routes/companyReviewersRoutes.js';
import payrollRoutes from './routes/payrollRoutes.js';
import reportsRoutes from './routes/reportsRoutes.js';
import payslipRoutes from './routes/payslipRoutes.js';
import p9aRoutes from './routes/p9aRoutes.js';
import auditRoutes from './routes/auditRoutes.js';
import authRoutes from './routes/authRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('WageDesk Backend is running!');
});

app.get('/api/ping', (req, res) => {
  console.log('Ping received at', new Date().toISOString());
  res.status(200).json({ message: 'pong', time: new Date().toISOString() });
});

app.use('/api', authRoutes);
// Schedule cleanup job to run every hour
cron.schedule('0 * * * *', () => {
  console.log('Running cleanup for expired recovery codes...');
  cleanupExpiredCodes();
});

// Schedule notification jobs
cron.schedule('0 8 * * *', () => { // 8 AM daily
  console.log('Running daily notification checks...');
  checkPayrollNotifications();
  checkContractExpirations();
  checkMissingEmployeeDetails();
});

cron.schedule('0 2 * * *', () => { // 2 AM daily
  console.log('Cleaning up old notifications...');
  cleanupOldNotifications();
});


app.use('/api', workspaceRouters)
app.use('/api', bankRoutes)
app.use('/api', notificationRoutes);

app.use('/api/company/:companyId/payroll/runs', reportsRoutes);
app.use('/api/company/:companyId', payrollRoutes);
app.use('/api/company/:companyId/payroll/payslip', payslipRoutes);
app.use('/api/company/:companyId/employees', p9aRoutes);
app.use('/api/company', helbRoutes);
app.use('/api/company', employeesRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/company', companyUsersRoutes);
app.use('/api/company', allowanceTypeRoutes);
app.use('/api/company', allowanceRoutes);
app.use('/api/company', deductionTypeRoutes);
app.use('/api/company', deductionRoutes);
app.use('/api/company', absentDaysRoutes);
app.use('/api/company', companyReviewersRoutes);
app.use('/api/company', auditRoutes);


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
