import express from "express";
import axios from "axios";

const router = express.Router();

/**
 * ATTACH REPO LOGIC
 * This route calls GitHub to create a webhook and tells the DB to link it to a group.
 */
router.post('/attach', async (req, res) => {
  const { repoFullName, groupId, userAccessToken } = req.body;
  
  // We assume you've attached your teammate's pool/controller to the req object
  // or imported it directly at the top of the file.
  const { dbController } = req; 

  try {
    // 1. Request GitHub to create a Webhook for this specific repository
    const githubResponse = await fetch(`https://api.github.com/repos/${repoFullName}/hooks`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${userAccessToken}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'web',
        active: true,
        events: ['push', 'pull_request'],
        config: {
          url: `${process.env.APP_URL}/api/webhooks/github`, // Your ngrok/production URL
          content_type: 'json',
          secret: process.env.GITHUB_WEBHOOK_SECRET // Shared secret for security
        }
      })
    });

    const hookData = await githubResponse.json();

    if (!githubResponse.ok) {
      throw new Error(`GitHub API Error: ${hookData.message}`);
    }

    // 2. Database Hand-off (The part your teammate manages)
    // We pass the webhook_id so it can be stored in the 'group_repos' table
    await dbController.linkRepoToGroup(groupId, repoFullName, hookData.id);

    res.status(201).json({
      message: 'Successfully attached repo and registered webhook',
      webhook_id: hookData.id
    });

  } catch (error) {
    console.error('Attach Repo Error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/:owner/:repo/download", async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { owner, repo } = req.params;

    try {
        const zipUrl = `https://api.github.com/repos/${owner}/${repo}/zipball`;

        const response = await axios.get(zipUrl, {
            responseType: "stream",
            headers: {
                // Ensure req.user.accessToken exists from your passport deserializer
                Authorization: `token ${req.user.accessToken}`,
                "User-Agent": "CodeShare-App",
                Accept: "application/vnd.github.v3+json"
            }
        });

        // Set headers for file download
        res.setHeader("Content-Disposition", `attachment; filename=${repo}.zip`);
        res.setHeader("Content-Type", "application/zip");

        // Pipe the GitHub stream directly to the client response
        response.data.pipe(res);

    } catch (err) {
        console.error("Download Error:", err.response?.data || err.message);
        res.status(err.response?.status || 500).json({ 
            error: "Failed to download repository from GitHub" 
        });
    }
});

// routes/repos.js
router.get("/", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).send("Unauthorized");

    try {
        const response = await axios.get("https://api.github.com/user/repos", {
            headers: {
                Authorization: `token ${req.user.accessToken}`,
                "User-Agent": "CodeShare-App"
            }
        });
        res.json(response.data);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch repos from GitHub" });
    }
});

//Make sure frontend uses "/search?repo_name=value"
router.get("/search", (req, res) => {
    const repoName = req.query.repo_name
    //TODO: Search in database fo specific reponame

})

export default router;
