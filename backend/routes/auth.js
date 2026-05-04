import dotenv from "dotenv";
dotenv.config();

import { Router } from "express";
import cookieParser from "cookie-parser";
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import axios from 'axios';
import { io } from "../server.js";
import pool from "../db/pool.js";

const authRouter = Router();

authRouter.use(cookieParser());

passport.use(new GitHubStrategy(
    {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: process.env.GITHUB_CALLBACK,
    },
    // Make the verify callback async so we can run DB queries.
    async (accessToken, refreshToken, profile, done) => {
        try {
            // Extract canonical fields from the GitHub profile.
            const githubId = profile.id;
            const username = profile.username || profile.displayName || null;
            const avatarUrl = profile.photos?.[0]?.value || null;

            // Upsert the user into the `users` table using the github_id as the unique key.
            // This creates the row on first login and updates the access token/username on subsequent logins.
            const result = await pool.query(
                `INSERT INTO users (github_id, username, avatar_url, access_token)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (github_id) DO UPDATE SET
                     access_token = EXCLUDED.access_token,
                     username = EXCLUDED.username,
                     avatar_url = EXCLUDED.avatar_url
                 RETURNING *`,
                [githubId, username, avatarUrl, accessToken]
            );

            const userRow = result.rows[0];

            // Build a user object to attach to the session. Include accessToken if you need API calls later.
            const user = {
                id: userRow.id,
                github_id: userRow.github_id,
                username: userRow.username,
                avatar_url: userRow.avatar_url,
                accessToken
            };

            return done(null, user);
        } catch (err) {
            return done(err);
        }
    }
));

authRouter.get("/auth", async (req, res) => {
    try {
        res.send("/auth");
    } catch (error) {
        return res.json({ error });
    }
});

authRouter.get("/success", async (req, res) => {
    try {
        res.send("/success!");
    } catch (error) {
        return res.json({ error });
    }
});

authRouter.get("/user", async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ authenticated: false });
    }
    return res.json({ authenticated: true, user: req.user });
});

authRouter.get("/github",
    passport.authenticate("github", { scope: ["user:email", "repo"] })
);

authRouter.get("/github/callback",
    passport.authenticate("github", { failureRedirect: "/login" }),
    (req, res) => {
        res.redirect("/");
    }
);

authRouter.get("/repos", async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
    }

    try {
        const token = req.user.accessToken;

        const response = await axios.get("https://api.github.com/user/repos", {
            headers: {
                Authorization: `token ${token}`,
                "User-Agent": "My-App"
            },
            params: {
                visibility: "all",
                sort: "updated",
                per_page: 20
            }
        });

        const simplifiedRepos = response.data.map(repo => ({
            name: repo.name,
            description: repo.description,
            private: repo.private,
            stargazers_count: repo.stargazers_count,
            language: repo.language,
            updated_at: repo.updated_at,
            html_url: repo.html_url
        }));

        res.json(simplifiedRepos);
    } catch (error) {
        console.error("GitHub API Error:", error.response?.data || error.message);
        res.status(error.response?.status || 500).json({ error: "Failed to fetch repositories" });
    }
});

export default authRouter;