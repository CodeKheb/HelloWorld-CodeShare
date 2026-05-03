import express from 'express'
import path from "path";
import { fileURLToPath } from "url";

const app = express()
const port = process.env.PORT || 3000

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.join(__filename)

console.log(port);

app.use(express.urlencoded({ extended: true })); //Used to read and understand data sent from HTML forms
app.use(express.static(path.join(__dirname, "../frontend"))) //Serve static frontend files
app.use(express.json())

const server = app.listen(port, () => 
    console.log(`Listening to port ${port}`)
)

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend", 'index.html'));
})

app.get("/hello", (req, res) => {
    res.send({message: "hello"})
})

