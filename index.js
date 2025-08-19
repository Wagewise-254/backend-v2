// backend/index.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import  {sendEmail, getPayslipEmailTemplate}  from './services/email.js'; 
import companyRoutes from './routes/companyRoutes.js'
import hrRoutes from './routes/hrRoutes.js';
//import payrollRoutes from './routes/payrollRoutes.js';
import helbRoutes from './routes/helbRoutes.js';
import statutoryRoutes from './routes/statutoryRoutes.js';
import allowanceRoutes from './routes/allowanceRoutes.js';
import allowanceTypeRoutes from './routes/allowanceTypeRoutes.js';
import deductionRoutes from './routes/deductionRoutes.js';
import deductionTypeRoutes from './routes/deductionTypeRoutes.js';
import payrollRoutes from './routes/payrollRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import payslipRoutes from './routes/payslipRoutes.js';
import multer from 'multer'

dotenv.config();

const app = express();
app.use(cors()); // Allow requests from your frontend
app.use(express.json());
const upload = multer();

app.get('/', (req, res) => {
    res.send('WageWise Backend is running!');
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
                    // --- PASTE YOUR FULL HTML TEMPLATE HERE ---
                    // Remember to replace placeholders with ${userName} etc.
                    Hello ${userName}, Welcome to Wagewise!
                    // ... rest of your beautiful email template
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
app.use('/api/companies', companyRoutes);

// Use HR-related routes (e.g., /api/company/:companyId/employees, /api/company/:companyId/departments)
app.use('/api/company', hrRoutes);

// Use Payroll-related routes (e.g., /api/company/:companyId/payroll/runs)
//app.use('/api/company', payrollRoutes);

// Use Allowance routes
app.use('/api/company', allowanceRoutes);
app.use('/api/company', allowanceTypeRoutes);

// Use Deduction routes
app.use('/api/company', deductionRoutes);
app.use('/api/company', deductionTypeRoutes);

// Mount under company & employee context
app.use('/api/companies/:companyId/', helbRoutes);

// Mount statutory routes
app.use('/api/companies/:companyId', statutoryRoutes);

// Use Payroll-related routes (e.g., /api/company/:companyId/payroll/runs)
app.use('/api/company/:companyId', payrollRoutes); // Use the new routes

// Mount the new dashboard routes
app.use('/api/company/:companyId', dashboardRoutes);
app.use('/api/company/:companyId/payroll/payslip', payslipRoutes);



const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});