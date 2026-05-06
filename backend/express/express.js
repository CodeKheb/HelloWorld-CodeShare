import express from 'express'
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import session from 'express-session';
import passport from "passport";
import pool from "../db/pool.js";
import { handleGithubWebhook } from '../webhooks/github.js';

export const app = express()

// When behind a reverse proxy (Render, Heroku, etc.) enable trust proxy
// so that secure cookies and req.protocol are detected correctly.
app.set('trust proxy', 1);

const __filename = fileURLToPath(import.meta.url)
export const __dirname = path.dirname(__filename)

import authRouter from '../routes/auth.js';
import groupsRouter from '../routes/groups.js';
import reposRouter from '../routes/repos.js';
import messagesRouter from '../routes/messages.js';
import dashboardRouter from '../routes/dashboard.js';

const requireAuth = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }

    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ message: 'Not authenticated' });
    }

    return res.redirect('/login');
};

app.use(express.urlencoded({ extended: true }));
app.use(express.json({
    verify: (req, _res, buf) => {
        req.rawBody = buf;
    }
}));

// Resolve frontend path robustly for local and containerized environments.
const frontendCandidates = [
    path.resolve(__dirname, "../../frontend"),
    path.resolve(__dirname, "../frontend"),
    path.resolve(process.cwd(), "frontend"),
    path.resolve(process.cwd(), "../frontend")
];

const frontendPath = frontendCandidates.find(candidate => fs.existsSync(candidate))
    || path.resolve(process.cwd(), "frontend");

console.log(`[EXPRESS] Resolved frontend path: ${frontendPath}`);
app.use(express.static(frontendPath, { index: false }));


export const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || "trial-secret",
    resave: false,
    saveUninitialized: false,
        proxy: true,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' ? true : false,
        sameSite: 'lax',
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

app.get('/', (req, res) => {
        if (req.isAuthenticated()) {
                return res.sendFile(path.join(frontendPath, 'index.html'));
        }

        // Public visitors see the styled login page.
        return res.sendFile(path.join(frontendPath, 'login.html'));
});

app.get('/login', (req, res) => {
    if (req.isAuthenticated()) {
        return res.redirect('/');
    }
    res.sendFile(path.join(frontendPath, 'login.html'));
});

app.get('/messages', requireAuth, (req, res) => {
    res.sendFile(path.join(frontendPath, 'messages.html'));
});

app.get('/groups', requireAuth, (req, res) => {
    res.sendFile(path.join(frontendPath, 'groups.html'));
});

app.get("/hello", (req, res) => {
    res.send({ message: "hello" });
});

app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true, service: 'backend' });
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

app.post("/api/webhooks/github", (req, res) => {
    handleGithubWebhook(req, res);
});

app.use("/api/auth", authRouter);
app.use("/api/groups", groupsRouter);
app.use("/api/repos", reposRouter);
app.use("/api/messages", messagesRouter);
app.use("/api/dashboard", dashboardRouter);
