import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

import { Server } from "socket.io";
import { app } from "./express/express.js";
import chatHandler from "./socket/chat.js";
import { socketMapList, userInit } from "./socket/activeSockets";

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

io.on("connection", (socket) => {
    userInit(socket.id);

    socket.on("disconnect", () => {
        socketMapList.delete(socket.id);
    });

    let activeSockets = Array.from(io.sockets.adapter.sids.keys());
    
    console.log(activeSockets);
    
    console.log(socketMapList);
    

    chatHandler(socket);
});