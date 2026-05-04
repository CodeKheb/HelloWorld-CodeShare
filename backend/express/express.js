import express from 'express'
import path from "path";
import { fileURLToPath } from "url";
import session from 'express-session';
import passport from "passport";

export const app = express()
const port = process.env.PORT || 3000

const __filename = fileURLToPath(import.meta.url)
export const __dirname = path.dirname(__filename)

import authRouter from '../routes/auth.js';

console.log(port);

const requireAuth = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
};

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "../../frontend"), { index: false }));

app.use(sessionMiddleware);

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

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

app.use("/api/auth", authRouter);