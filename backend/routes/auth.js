import dotenv from "dotenv";
dotenv.config();

import { Router } from "express";
import cookieParser from "cookie-parser";
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import axios from 'axios';

const authRouter = Router();

authRouter.use(cookieParser())
authRouter.use(passport.initialize())
authRouter.use(passport.session())


passport.use(new GitHubStrategy(
{
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: process.env.GITHUB_CALLBACK,
},

(accessToken, refreshToken, profile, done) => {
    // You can save user to DB here later
    return done(null, {
        id: profile.id,
        username: profile.username,
        displayName: profile.displayName,
        avatar: profile.photos?.[0]?.value,
        accessToken
    });
}
));

authRouter.get("/auth", async (req, res) => {
    try {
        res.send("/auth")
    } catch (error) {
        return res.json({error})
    }
})

authRouter.get("/success", async (req, res) => {
    try {
        res.send("/success!")
    } catch (error) {
        return res.json({error})
    }
})

authRouter.get("/user", async (req, res) => {
    // changed this to passport auth
    if (!req.isAuthenticated()) {
        return res.status(401).json({ authenticated: false });
    }
    return res.json({ authenticated: true, user: req.user });
});

// Redirect to GitHub
authRouter.get("/github",
    passport.authenticate("github", { scope: ["user:email", "repo"] })
);

// Callback URL
authRouter.get("/github/callback",
    passport.authenticate("github", {
        failureRedirect: "/login",
    }),
    (req, res) => {
        // success login
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
                visibility: "all", // "all", "public", or "private"
                sort: "updated",
                per_page: 20
            }
        });

        // PARSING LOGIC: Map through the raw data
        const simplifiedRepos = response.data.map(repo => {
            return {
                name: repo.name,
                description: repo.description,
                private: repo.private,
                stargazers_count: repo.stargazers_count,
                language: repo.language,
                updated_at: repo.updated_at,
                html_url: repo.html_url
            };
        });

        res.json(simplifiedRepos);
    } catch (error) {
        console.error("GitHub API Error:", error.response?.data || error.message);
        res.status(error.response?.status || 500).json({ error: "Failed to fetch repositories" });
    }
});

export default authRouter;
