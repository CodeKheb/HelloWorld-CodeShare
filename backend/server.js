import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

import { Server } from "socket.io";
import { app, sessionMiddleware } from "./express/express.js";
import chatHandler from "./socket/chat.js";
import { socketMapList, userInit } from "./socket/activeSockets.js";

const port = process.env.PORT || 3000;

const expressEndpoint = app.listen(port, () => {
    console.log(`Listening at port ${port}`);
});

export const io = new Server(expressEndpoint, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

// Share session middleware with Socket.IO
io.use((socket, next) => sessionMiddleware(socket.request, {}, next));

io.on("connection", (socket) => {
    userInit(socket.id);

    // Store socket ID in session so auth route can find it
    socket.request.session.socketId = socket.id;
    socket.request.session.save();

    socket.on("disconnect", () => {
        socketMapList.delete(socket.id);
    });

    let activeSockets = Array.from(io.sockets.adapter.sids.keys());
    
    console.log(activeSockets);
    
    console.log(socketMapList);
    

    chatHandler(socket);
});