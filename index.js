// backend/index.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import  sendEmail  from './services/email.js'; 
import companyRoutes from './routes/companyRoutes.js'
import hrRoutes from './routes/hrRoutes.js';
import payrollRoutes from './routes/payrollRoutes.js';

dotenv.config();

const app = express();
app.use(cors()); // Allow requests from your frontend
app.use(express.json());

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

// Use the new company routes
app.use('/api/companies', companyRoutes);

// Use HR-related routes (e.g., /api/company/:companyId/employees, /api/company/:companyId/departments)
app.use('/api/company', hrRoutes);

// Use Payroll-related routes (e.g., /api/company/:companyId/payroll/runs)
app.use('/api/company', payrollRoutes);


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});