import express from 'express'
import path from "path";
import { fileURLToPath } from "url";
import session from 'express-session';
import passport from "passport";
import pool from "../db/pool.js";
import { handleGithubWebhook } from '../webhooks/github.js';
import { io } from '../server.js';

export const app = express()

const __filename = fileURLToPath(import.meta.url)
export const __dirname = path.dirname(__filename)

import authRouter from '../routes/auth.js';
import groupsRouter from '../routes/groups.js';
import reposRouter from '../routes/repos.js';

const requireAuth = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
};

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "../../frontend"), { index: false }));


export const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || "trial-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
});

app.use(sessionMiddleware);

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
    try {
        const result = await pool.query(
            "SELECT id, github_id, username, avatar_url, access_token FROM users WHERE id = $1",
            [id]
        );

        if (result.rows.length === 0) {
            return done(null, false);
        }

        const userRow = result.rows[0];

        return done(null, {
            id: userRow.id,
            github_id: userRow.github_id,
            username: userRow.username,
            avatar_url: userRow.avatar_url,
            accessToken: userRow.access_token
        });
    } catch (error) {
        return done(error);
    }
});

app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "../../frontend", 'index.html'));
});

app.get('/login', (req, res) => {
    if (req.isAuthenticated()) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, "../../frontend", 'login.html'));
});

app.get('/messages', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "../../frontend", 'messages.html'));
});

app.get('/groups', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "../../frontend", 'groups.html'));
});

app.get("/hello", (req, res) => {
    res.send({ message: "hello" });
});

app.get('/api/user', requireAuth, (req, res) => {
    res.json({
        authenticated: true,
        user: {
            id: req.user.id,
            github_id: req.user.github_id,
            username: req.user.username,
            displayName: req.user.username, 
            avatar: req.user.avatar_url
        }
    });
});

// FAKE db controller for testing of webhooks
const mockDbController = {
  saveSystemMessage: async (repoFullName, content) => {
    console.log(`[MOCK DB] Saving to DB: Repo: ${repoFullName}, Content: ${content}`);
    // Return a fake object that looks like your SQL schema
    return { 
      group_id: 1, // Just a guess for testing
      content: content,
      type: 'system' 
    };
  }
};

app.post("/api/webhooks/github", (req, res) => {
  // Pass the dependencies (db and socket) so the webhook logic can use them
  handleGithubWebhook(req, res, mockDbController, io);
});

app.use("/api/auth", authRouter);
app.use("/api/groups", groupsRouter);
app.use("/api/repos", reposRouter);
