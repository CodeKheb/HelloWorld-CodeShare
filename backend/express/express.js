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

let authenticated = true;

app.use(express.urlencoded({ extended: true })); //Used to read and understand data sent from HTML forms
app.use(express.json()) // order matters 
app.use(express.static(path.join(__dirname, "../../frontend"), { index: false })) //Serve static frontend files

app.use(session({
  secret: process.env.SESSION_SECRET || 'TRIAL', // Use env variable
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true } // httpOnly is important for security
}));

app.use(passport.initialize())
app.use(passport.session())

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "../../frontend", 'index.html'))
})

app.get('/login', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/'); // already logged in
  }
  res.sendFile(path.join(__dirname, "../../frontend", 'login.html'));
})

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, "../../frontend", 'login.html'));
})

app.get('/messages', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "../../frontend", 'messages.html'));
})

app.get('/groups', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "../../frontend", 'groups.html'));
})

app.get("/hello", (req, res) => {
    res.send({message: "hello"})
})

app.use("/api/auth", authRouter)
