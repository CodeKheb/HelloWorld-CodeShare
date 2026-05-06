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
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png">
    <title>CodeShare - Login</title>
    <style>
        :root {
            --bg: #0d0f12;
            --bg-panel: #161b22;
            --bg-accent: #0f150e;
            --border: #30363d;
            --text: #f0f6fc;
            --muted: #8b949e;
            --brand: #67df70;
            --brand-hover: #83fc89;
            --blue: #388bfd;
            --radius: 16px;
            --shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
        }

        * { box-sizing: border-box; }
        html, body { min-height: 100%; }
        body {
            margin: 0;
            font-family: Inter, system-ui, sans-serif;
            color: var(--text);
            background:
                radial-gradient(circle at top, rgba(103, 223, 112, 0.16), transparent 32%),
                radial-gradient(circle at bottom right, rgba(56, 139, 253, 0.12), transparent 28%),
                radial-gradient(#30363d 1px, transparent 1px),
                linear-gradient(180deg, #0d0f12 0%, #090b0f 100%);
            background-size: auto, auto, 20px 20px, auto;
            background-position: center, center, 0 0, center;
        }

        .page {
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 24px;
        }

        .login-card {
            width: min(100%, 420px);
            padding: 32px;
            border: 1px solid var(--border);
            border-radius: var(--radius);
            background: linear-gradient(180deg, rgba(22, 27, 34, 0.96), rgba(15, 21, 14, 0.96));
            box-shadow: var(--shadow);
            text-align: center;
            backdrop-filter: blur(10px);
        }

        .brand-mark {
            width: 72px;
            height: 72px;
            margin: 0 auto 16px;
            border-radius: 18px;
            border: 1px solid var(--border);
            background: var(--bg-accent);
            display: grid;
            place-items: center;
            color: var(--brand);
            box-shadow: inset 0 0 0 1px rgba(103, 223, 112, 0.08);
        }

        .brand-mark span {
            font-size: 34px;
            font-weight: 900;
            letter-spacing: -0.08em;
        }

        h1 {
            margin: 0;
            font-size: 28px;
            line-height: 1.15;
            letter-spacing: -0.03em;
        }

        .tagline {
            margin: 10px 0 28px;
            font-size: 15px;
            line-height: 1.55;
            color: var(--muted);
        }

        .github-button {
            width: 100%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            border: 0;
            border-radius: 8px;
            padding: 14px 16px;
            background: var(--brand);
            color: #0d0f12;
            font: 700 15px/1.2 system-ui, sans-serif;
            cursor: pointer;
            transition: transform 160ms ease, background-color 160ms ease, box-shadow 160ms ease;
            box-shadow: 0 10px 24px rgba(103, 223, 112, 0.18);
        }

        .github-button:hover {
            background: var(--brand-hover);
            transform: translateY(-1px);
        }

        .github-button:focus-visible {
            outline: 2px solid var(--blue);
            outline-offset: 3px;
        }

        .github-icon {
            width: 20px;
            height: 20px;
            fill: currentColor;
            flex: 0 0 auto;
        }

        .fine-print {
            margin: 16px 0 0;
            font-size: 13px;
            line-height: 1.5;
            color: var(--muted);
        }

        .fine-print a {
            color: var(--text);
            text-decoration-color: rgba(240, 246, 252, 0.45);
        }

        @media (max-width: 480px) {
            .page { padding: 24px; }
            .login-card {
                padding: 20px 16px;
                border-radius: 12px;
                width: min(100%, 320px);
            }
            h1 { font-size: 20px; }
            .tagline { font-size: 13px; margin: 6px 0 16px; }
            .brand-mark { width: 64px; height: 64px; border-radius: 12px; }
            .brand-mark span { font-size: 28px; }
            .github-button { padding: 11px 14px; font-size: 14px; }
            .fine-print { font-size: 12px; margin: 12px 0 0; }
        }
    </style>
</head>
<body>
    <main class="page">
        <section class="login-card" aria-labelledby="login-title">
            <div class="brand-mark" aria-hidden="true"><span>CS</span></div>
            <h1 id="login-title">CodeShare</h1>
            <p class="tagline">Where your team and your repos actually talk to each other.</p>
            <button class="github-button" onclick="window.location.href='/api/auth/github'">
                <svg class="github-icon" aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"></path>
                </svg>
                Continue with GitHub
            </button>
            <p class="fine-print">To sign in with a different account, <a href="https://github.com/logout" target="_blank" rel="noreferrer">log out of GitHub</a> first.</p>
            <p class="fine-print">We only request read access to your public profile and repo webhooks.</p>
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
    return res.status(200).type('html').send(fallbackLoginHtml);
});

app.get('/login', (req, res) => {
    if (req.isAuthenticated()) {
        return res.redirect('/');
    }
    return res.status(200).type('html').send(fallbackLoginHtml);
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
