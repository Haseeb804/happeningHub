const nodemailer = require('nodemailer');
require('dotenv').config(); 
const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: "haseebahamad4601034@gmail.com",
      pass: "kpzk keaz hrwo cboj"
    },
    tls: {
      rejectUnauthorized: false
    }
  });

exports.sendInvitationEmail = async (speakerEmail, eventDetails, invitationId) => {
    try {
      if (!process.env.BASE_URL) {
        throw new Error('BASE_URL environment variable not set');
      }
      
      const acceptLink = `${process.env.BASE_URL}/api/invitations/accept/${invitationId}`;
      const rejectLink = `${process.env.BASE_URL}/api/invitations/reject/${invitationId}`;
  
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: speakerEmail,
        subject: `Invitation to speak at ${eventDetails.title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <h2 style="color: #2c3e50;">Speaker Invitation</h2>
            <p>You've been invited to speak at <strong>${eventDetails.title}</strong></p>
            
            <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
              <h3 style="margin-top: 0;">Event Details</h3>
              <p><strong>Date:</strong> ${eventDetails.date}</p>
              <p><strong>Time:</strong> ${eventDetails.time}</p>
              <p><strong>Venue:</strong> ${eventDetails.venueName}</p>
              ${eventDetails.venueAddress ? `<p><strong>Address:</strong> ${eventDetails.venueAddress}</p>` : ''}
              <p><strong>Description:</strong> ${eventDetails.description}</p>
            </div>
            
            <div style="margin: 20px 0; text-align: center;">
              <a href="${acceptLink}" 
                 style="background-color: #27ae60; color: white; padding: 10px 20px; 
                        text-decoration: none; border-radius: 5px; margin-right: 10px;">
                Accept Invitation
              </a>
              <a href="${rejectLink}" 
                 style="background-color: #e74c3c; color: white; padding: 10px 20px; 
                        text-decoration: none; border-radius: 5px;">
                Decline
              </a>
            </div>
          </div>
        `
      };
  
      await transporter.sendMail(mailOptions);
      console.log(`Invitation email sent to ${speakerEmail}`);
    } catch (error) {
      console.error('Error sending invitation email:', error);
      throw new Error('Failed to send invitation email');
    }
  };;

exports.sendReminderEmail = async (speakerEmail, eventDetails, invitationId) => {
  const acceptLink = `${process.env.BASE_URL}/api/invitations/accept/${invitationId}`;
  const rejectLink = `${process.env.BASE_URL}/api/invitations/reject/${invitationId}`;
  

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: speakerEmail,
    subject: `Reminder: Pending invitation for ${eventDetails.title}`,
    html: `
      <p>This is a reminder about your pending invitation to speak at ${eventDetails.title}.</p>
      <p>Please respond to this invitation:</p>
      <a href="${acceptLink}">Accept Invitation</a> | 
      <a href="${rejectLink}">Reject Invitation</a>
    `
  };

  await transporter.sendMail(mailOptions);
};