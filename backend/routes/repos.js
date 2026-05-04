import express from "express";
import axios from "axios";

const router = express.Router();

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

export default router;
