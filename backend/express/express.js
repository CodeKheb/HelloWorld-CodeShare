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


app.get('/', (req, res) => {
    if (authenticated) {
        res.sendFile(path.join(__dirname, "../../frontend", 'index.html'))
    } else {
        res.sendFile(path.join(__dirname, "../../frontend", 'login.html'));
    }
})

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, "../../frontend", 'login.html'));
})

app.get('/messages', (req, res) => {
  res.sendFile(path.join(__dirname, "../../frontend", 'messages.html'));
})

app.get('/groups', (req, res) => {
  res.sendFile(path.join(__dirname, "../../frontend", 'groups.html'));
})

app.get("/hello", (req, res) => {
    res.send({message: "hello"})
})

app.use("/api/auth", authRouter)
