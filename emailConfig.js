// emailConfig.js
const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
      user: "haseebahamad4601034@gmail.com",
      pass: "kpzk keaz hrwo cboj"
  }
});

const sendPasswordResetEmail = async (email, resetCode) => {
  try {
    const mailOptions = {
      from: `"Event Management System" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Password Reset Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2c3e50;">Password Reset Request</h2>
          <p>We received a request to reset your password. Use the following code to proceed:</p>
          <div style="background-color: #f8f9fa; border: 1px solid #dee2e6; 
                      padding: 10px 15px; margin: 20px 0; font-size: 24px; 
                      font-weight: bold; text-align: center; color: #2c3e50;">
            ${resetCode}
          </div>
          <p>This code will expire in 15 minutes. If you didn't request a password reset, 
             you can safely ignore this email.</p>
          <p style="color: #7f8c8d; font-size: 12px; margin-top: 20px;">
            For security reasons, please don't share this code with anyone.
          </p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Error sending password reset email:', error);
    throw new Error('Failed to send password reset email');
  }
};

module.exports = {
  transporter,
  sendPasswordResetEmail
};