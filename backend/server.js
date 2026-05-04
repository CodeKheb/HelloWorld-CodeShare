import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();
// dotenv.config({ path: path.join(__dirname, ".env") });

import { Server } from "socket.io";
import { createServer } from "http";
import { app, sessionMiddleware } from "./express/express.js";
import passport from "passport";
import chatHandler from "./socket/chat.js";
import { socketMapList, userInit } from "./socket/activeSockets";

const port = process.env.PORT || 3000;

const httpServer = createServer(app);

export const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    }
});

// Wrap middleware to use with socket.io
const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);

io.use(wrap(sessionMiddleware));
io.use(wrap(passport.initialize()));
io.use(wrap(passport.session()));

io.on("connection", (socket) => {
    const user = socket.request.user;

    console.log('Socket connected:', socket.id);
    console.log('Authenticated user:', user);

    // Authenticated
    if (user) {
        userInit(socket.id, {
            authenticated: true,
            github_id: user.github_id,
            username: user.username,
            avatar_url: user.avatar_url,
            access_token: user.accessToken,
            display_name: user.username
        });

        socket.userId = user.github_id;
        socket.username = user.username;

        // Direct messages
        socket.join(`user:${user.github_id}`);

        console.log(`User ${user.username} connected with socket ${socket.id}`);
    } else {
        // Unauthenticated 
        userInit(socket.id, {
            authenticated: false,
            github_id: null,
            username: null,
            avatar_url: null,
            access_token: null
        });

        console.log('Unauthenticated socket connected:', socket.id);
    }

    socket.on("disconnect", () => {
        socketMapList.delete(socket.id);
        console.log('Socket disconnected:', socket.id);
    });

    let activeSockets = Array.from(io.sockets.adapter.sids.keys());
    console.log('Active sockets:', activeSockets);
    console.log('Socket map:', socketMapList);

    chatHandler(socket);
});

// start server
httpServer.listen(port, () => {
    console.log(`Server listening at port ${port}`);
});
