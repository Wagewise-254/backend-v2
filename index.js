// backend/index.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import  {sendEmail, getPayslipEmailTemplate}  from './services/email.js'; 
import companyRoutes from './routes/companyRoutes.js'
import hrRoutes from './routes/hrRoutes.js';
import helbRoutes from './routes/helbRoutes.js';
import statutoryRoutes from './routes/statutoryRoutes.js';
import allowanceRoutes from './routes/allowanceRoutes.js';
import allowanceTypeRoutes from './routes/allowanceTypeRoutes.js';
import deductionRoutes from './routes/deductionRoutes.js';
import deductionTypeRoutes from './routes/deductionTypeRoutes.js';
import payrollRoutes from './routes/payrollRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import payslipRoutes from './routes/payslipRoutes.js';
import reportsRoutes from './routes/reportsRoutes.js';
import p9aRoutes from './routes/p9aRoutes.js';
import multer from 'multer'

dotenv.config();

const app = express();
app.use(cors()); // Allow requests from your frontend
app.use(express.json());
const upload = multer();

app.get('/', (req, res) => {
    res.send('WageWise Backend is running!');
});

app.get('/api/ping', (req, res) => {
  console.log('Ping received at', new Date().toISOString());
  res.status(200).json({ message: 'pong', time: new Date().toISOString() });
});



// Endpoint to send the welcome email
app.post('/api/welcome-email', async (req, res) => {
    const { email, userName } = req.body;
    if (!email || !userName) {
        return res.status(400).json({ error: 'Email and userName are required.' });
    }

    try {
        await sendEmail({
            to: email,
            subject: `Welcome to WageWise, ${userName}!`,
            html: `
                <div style="font-family: Arial, sans-serif; ...">
                    Hello ${userName}, Welcome to Wagewise!
                </div>
            `
        });
        res.status(200).json({ message: 'Welcome email sent successfully.' });
    } catch (error) {
        console.error('Failed to send welcome email:', error);
        res.status(500).json({ error: 'Failed to send welcome email.' });
    }
});

// New endpoint to send payslip email with attachment
// Use the new company routes
// This line handles all the routes defined in companyRoutes.js
app.use('/api/companies', companyRoutes);

// Correctly mount other routes
app.use('/api/companies/:companyId/', helbRoutes);
app.use('/api/companies/:companyId', statutoryRoutes);
app.use('/api/company/:companyId', payrollRoutes);
app.use('/api/company/:companyId', dashboardRoutes);
app.use('/api/company/:companyId/payroll/payslip', payslipRoutes);
app.use('/api/companies/:companyId/payroll/runs', reportsRoutes);
app.use('/api/companies/:companyId/employees', p9aRoutes);
app.use('/api/company', hrRoutes);
app.use('/api/company', allowanceRoutes);
app.use('/api/company', allowanceTypeRoutes);
app.use('/api/company', deductionRoutes);
app.use('/api/company', deductionTypeRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
