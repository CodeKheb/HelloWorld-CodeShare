import express from "express";
import axios from "axios";
import { io } from "../server.js";

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

/**
 * CREATE NEW REPOSITORY
 * Creates a new GitHub repository using OAuth2 authenticated user's token
 */
router.post('/create', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { 
    name,
    description = "",
    private: isPrivate = false,
    auto_init = true,
    gitignore_template = null,
    license_template = null
  } = req.body;

  // Validate required fields
  if (!name) {
    return res.status(400).json({ error: "Repository name is required" });
  }

  try {
    const response = await axios.post(
      'https://api.github.com/user/repos',
      {
        name,
        description,
        private: isPrivate,
        auto_init, // Initialize with README
        gitignore_template, // e.g., "Node", "Python", "Java"
        license_template // e.g., "mit", "apache-2.0"
      },
      {
        headers: {
          Authorization: `token ${req.user.accessToken}`,
          "User-Agent": "CodeShare-App",
          Accept: "application/vnd.github.v3+json"
        }
      }
    );

    res.status(201).json({
      message: "Repository created successfully",
      repository: {
        id: response.data.id,
        name: response.data.name,
        full_name: response.data.full_name,
        html_url: response.data.html_url,
        clone_url: response.data.clone_url,
        ssh_url: response.data.ssh_url,
        private: response.data.private,
        description: response.data.description
      }
    });
  } catch (error) {
    console.error('Create Repository Error:', error.response?.data || error.message);
    
    // Handle specific GitHub API errors
    if (error.response?.status === 422) {
      return res.status(422).json({ 
        error: "Repository name already exists or is invalid" 
      });
    }
    
    res.status(error.response?.status || 500).json({ 
      error: error.response?.data?.message || "Failed to create repository" 
    });
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

/**
 * GET REPOSITORY COMMITS
 * Fetches commits from a specific repository using GitHub's API
 */
router.get("/:owner/:repo/commits", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const { owner, repo } = req.params;
  
  // Optional query parameters for filtering commits
  const {
    sha = null,        // Branch/SHA to start listing commits from
    path = null,         // Only commits containing this file path
    author = null,       // GitHub login or email address
    since = null,        // ISO 8601 date - only commits after this date
    until = null,        // ISO 8601 date - only commits before this date
    per_page = 30,       // Results per page (max 100)
    page = 1             // Page number
  } = req.query;

  try {
    // Build the query parameters
    const params = new URLSearchParams({
      per_page: Math.min(parseInt(per_page), 100),
      page: parseInt(page)
    });

    if (sha) params.append('sha', sha); 
    if (path) params.append('path', path);
    if (author) params.append('author', author);
    if (since) params.append('since', since);
    if (until) params.append('until', until);

    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/commits?${params.toString()}`,
      {
        headers: {
          Authorization: `token ${req.user.accessToken}`,
          "User-Agent": "CodeShare-App",
          Accept: "application/vnd.github.v3+json"
        }
      }
    );

    // Format the response to include relevant commit information
    const commits = response.data.map(commit => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: {
        name: commit.commit.author.name,
        email: commit.commit.author.email,
        date: commit.commit.author.date,
        username: commit.author?.login || null,
        avatar_url: commit.author?.avatar_url || null
      },
      committer: {
        name: commit.commit.committer.name,
        email: commit.commit.committer.email,
        date: commit.commit.committer.date
      },
      html_url: commit.html_url,
      parents: commit.parents.map(p => p.sha),
      stats: commit.stats || null // Only available if you fetch individual commits
    }));

    res.json({
      repository: `${owner}/${repo}`,
      branch: sha || 'default',
      commits,
      pagination: {
        current_page: parseInt(page),
        per_page: parseInt(per_page),
        total_commits: commits.length
      }
    });

  } catch (error) {
    console.error('Fetch Commits Error:', error.response?.data || error.message);
    
    // Handle specific errors
    if (error.response?.status === 404) {
      return res.status(404).json({ 
        error: "Repository not found or you don't have access" 
      });
    }
    
    if (error.response?.status === 409) {
      return res.status(409).json({ 
        error: "Repository is empty (no commits yet)" 
      });
    }

    res.status(error.response?.status || 500).json({ 
      error: error.response?.data?.message || "Failed to fetch commits from GitHub" 
    });
  }
});

/**
 * GET SINGLE COMMIT DETAILS
 * Fetches detailed information about a specific commit including file changes
 */
router.get("/:owner/:repo/commits/:sha", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { owner, repo, sha } = req.params;

  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`,
      {
        headers: {
          Authorization: `token ${req.user.accessToken}`,
          "User-Agent": "CodeShare-App",
          Accept: "application/vnd.github.v3+json"
        }
      }
    );

    const commit = response.data;

    res.json({
      sha: commit.sha,
      message: commit.commit.message,
      author: {
        name: commit.commit.author.name,
        email: commit.commit.author.email,
        date: commit.commit.author.date,
        username: commit.author?.login || null,
        avatar_url: commit.author?.avatar_url || null
      },
      committer: {
        name: commit.commit.committer.name,
        email: commit.commit.committer.email,
        date: commit.commit.committer.date
      },
      stats: {
        additions: commit.stats.additions,
        deletions: commit.stats.deletions,
        total: commit.stats.total
      },
      files: commit.files.map(file => ({
        filename: file.filename,
        status: file.status, // "added", "removed", "modified", "renamed"
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch, // The actual diff
        previous_filename: file.previous_filename || null
      })),
      html_url: commit.html_url,
      parents: commit.parents.map(p => ({
        sha: p.sha,
        url: p.url
      }))
    });

  } catch (error) {
    console.error('Fetch Commit Error:', error.response?.data || error.message);
    
    if (error.response?.status === 404) {
      return res.status(404).json({ 
        error: "Commit not found" 
      });
    }

    res.status(error.response?.status || 500).json({ 
      error: error.response?.data?.message || "Failed to fetch commit from GitHub" 
    });
  }
});

export default router;
