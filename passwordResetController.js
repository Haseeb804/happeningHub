// passwordResetController.js
const { sendPasswordResetEmail } = require('./emailConfig');
const neo4j = require('neo4j-driver');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

const initiatePasswordReset = async (email) => {
  const session = driver.session();
  try {
    // Check if user exists
    const result = await session.run(
      `MATCH (u:Attendee|Organizer|Speaker {email: $email}) RETURN u`,
      { email }
    );
    
    if (result.records.length === 0) {
      // Don't reveal if user exists or not for security
      return true;
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now

    // Store the reset code
    await session.run(
      `MATCH (u:Attendee|Organizer|Speaker {email: $email})
       SET u.passwordResetCode = $code,
           u.passwordResetExpires = $expiresAt`,
      { email, code, expiresAt: expiresAt.toISOString() }
    );

    // Send email with the code
    await sendPasswordResetEmail(email, code);
    return true;
  } catch (err) {
    console.error("Error initiating password reset:", err);
    // Still return true to not reveal if the email exists
    return true;
  } finally {
    await session.close();
  }
};

const verifyResetCode = async (email, code) => {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (u:Attendee|Organizer|Speaker {email: $email})
       RETURN u.passwordResetCode AS code, 
              datetime(u.passwordResetExpires) AS expiresAt`,
      { email }
    );

    if (result.records.length === 0) {
      throw new Error("User not found");
    }

    const record = result.records[0];
    const storedCode = record.get('code');
    const expiresAt = record.get('expiresAt');

    if (!storedCode || !expiresAt) {
      throw new Error("No reset code requested");
    }

    if (new Date(expiresAt.toString()) < new Date()) {
      throw new Error("Reset code has expired");
    }

    if (storedCode !== code) {
      throw new Error("Invalid reset code");
    }

    return true;
  } catch (err) {
    console.error("Error verifying reset code:", err);
    throw new Error(err.message || "Failed to verify reset code");
  } finally {
    await session.close();
  }
};

const updatePassword = async (email, newPassword) => {
  const session = driver.session();
  try {
    // Verify the user exists
    const result = await session.run(
      `MATCH (u:Attendee|Organizer|Speaker {email: $email}) RETURN u`,
      { email }
    );
    
    if (result.records.length === 0) {
      throw new Error("User not found");
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the password and clear reset fields
    await session.run(
      `MATCH (u:Attendee|Organizer|Speaker {email: $email})
       SET u.password = $hashedPassword,
           u.passwordResetCode = null,
           u.passwordResetExpires = null`,
      { email, hashedPassword }
    );

    return true;
  } catch (err) {
    console.error("Error updating password:", err);
    throw new Error("Failed to update password");
  } finally {
    await session.close();
  }
};

module.exports = {
  initiatePasswordReset,
  verifyResetCode,
  updatePassword
};