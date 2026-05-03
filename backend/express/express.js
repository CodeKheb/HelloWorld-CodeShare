import express from 'express'
import path from "path";
import { fileURLToPath } from "url";

import authRouter from '../routes/auth.js';

const app = express()
const port = process.env.PORT || 3000

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log(port);

app.use(express.urlencoded({ extended: true })); //Used to read and understand data sent from HTML forms
app.use(express.static(path.join(__dirname, "../../frontend"), { index: false })) //Serve static frontend files
app.use(express.json())

app.use("/api/auth", authRouter)

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, "../../frontend", 'login.html'));
})

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, "../../frontend", 'index.html'));
})

app.get("/hello", (req, res) => {
    res.send({message: "hello"})
})

export default app;