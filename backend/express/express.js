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

const fallbackLoginHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CodeShare - Login</title>
    <style>
        body { margin: 0; font-family: system-ui, sans-serif; background: #0d0f12; color: #f0f6fc; }
        main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
        section { width: min(100%, 420px); padding: 32px; border: 1px solid #30363d; border-radius: 16px; background: #161b22; }
        a, button { color: inherit; }
        button { width: 100%; padding: 14px 16px; border: 0; border-radius: 8px; background: #67df70; color: #0d0f12; font-weight: 700; cursor: pointer; }
        p { color: #8b949e; line-height: 1.5; }
    </style>
</head>
<body>
    <main>
        <section>
            <h1>CodeShare</h1>
            <p>Where your team and your repos actually talk to each other.</p>
            <button type="button" onclick="window.location.href='/api/auth/github'">Continue with GitHub</button>
        </section>
    </main>
</body>
</html>`;

function sendFileOrFallback(res, filePath, fallbackHtml) {
    res.sendFile(filePath, (err) => {
        if (err) {
            console.warn(`[EXPRESS] Failed to send ${filePath}:`, err.message);
            res.status(200).type('html').send(fallbackHtml);
        }
    });
}


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
        return sendFileOrFallback(res, path.join(frontendPath, 'index.html'), fallbackLoginHtml);
        }

        // Public visitors see the styled login page.
    return sendFileOrFallback(res, path.join(frontendPath, 'login.html'), fallbackLoginHtml);
});

app.get('/login', (req, res) => {
    if (req.isAuthenticated()) {
        return res.redirect('/');
    }
    return sendFileOrFallback(res, path.join(frontendPath, 'login.html'), fallbackLoginHtml);
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
