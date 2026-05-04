import crypto from 'crypto';

/**
 * Logic for the Webhook Receiver
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Object} dbController - Your teammate's DB functions
 * @param {Object} io - Socket.io instance
 */
export const handleGithubWebhook = async (req, res, dbController, io) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET || "test_secret";
  const signature = req.headers['x-hub-signature-256'];

  // 1. Verification Logic (Security)
  const hmac = crypto.createHmac('sha256', secret);
  const digest = Buffer.from('sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex'), 'utf8');
  const checksum = Buffer.from(signature, 'utf8');

//   if (!crypto.timingSafeEqual(digest, checksum)) {
//     return res.status(401).send('Signatures did not match');
//   }

  const event = req.headers['x-github-event'];
  const payload = req.body;
  const repoFullName = payload.repository.full_name;

  // 2. Transformation Logic (Raw JSON -> Human Readable)
  let content = '';
  if (event === 'push') {
    content = ` **${payload.pusher.name}** pushed to \`${repoFullName}\``;
  } else if (event === 'pull_request' && payload.action === 'opened') {
    content = ` **${payload.sender.login}** opened PR: _"${payload.pull_request.title}"_ in \`${repoFullName}\``;
  }

  if (content) {
    try {
      // 3. Logic Hand-off to Teammate
      // We pass the string; they handle the INSERT into the 'messages' table
      const savedMsg = await dbController.saveSystemMessage(repoFullName, content);

      // 4. Real-time broadcast to the Group Chat View

      io.to(savedMsg.group_id).emit('new_message', savedMsg);
    } catch (error) {
      console.error('Error processing webhook delivery:', error);
    }
  }

  res.status(200).send('OK');
};