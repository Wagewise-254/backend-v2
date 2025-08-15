// backend/email.js
import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
    service: 'gmail', // Or another email provider
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const sendEmail = async ({ to, subject, html }) => {
    const mailOptions = {
        from: `"WageWise" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        html,
    };
    await transporter.sendMail(mailOptions);
};

export default sendEmail;