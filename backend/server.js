import { Server } from "socket.io"
import app from "./express/express.js"


const port = process.env.PORT || 3000

const expressEndpoint = app.listen(port, () => {
    console.log(`Listening at port ${port}`);
})

const io = new Server(expressEndpoint, {
    cors: {
         origin: "*", 
        methods: ["GET", "POST"],
    },
})

io.on("connection", (socket) => {
    
})


