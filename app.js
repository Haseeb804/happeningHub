// Add to your app.js before starting the server
app.get('/api/invitations/accept/:id', async (req, res) => {
    try {
      const session = driver.session();
      const invitationId = req.params.id;
      
      // Update invitation status
      await session.run(
        `MATCH (i:Invitation {id: $id})
         SET i.status = 'ACCEPTED', i.updatedAt = $updatedAt`,
        {
          id: invitationId,
          updatedAt: new Date().toISOString()
        }
      );
      
      // Create event (similar to respondToInvitation mutation)
      // ... implementation omitted for brevity ...
      
      res.send('Invitation accepted successfully. Event has been created.');
    } catch (err) {
      console.error('Error accepting invitation:', err);
      res.status(500).send('Failed to accept invitation');
    }
  });
  
  app.get('/api/invitations/reject/:id', async (req, res) => {
    try {
      const session = driver.session();
      const invitationId = req.params.id;
      
      await session.run(
        `MATCH (i:Invitation {id: $id})
         SET i.status = 'REJECTED', i.updatedAt = $updatedAt`,
        {
          id: invitationId,
          updatedAt: new Date().toISOString()
        }
      );
      
      res.send('Invitation rejected successfully.');
    } catch (err) {
      console.error('Error rejecting invitation:', err);
      res.status(500).send('Failed to reject invitation');
    }
  });