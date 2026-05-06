import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

import { Server } from "socket.io";
import { createServer } from "http";
import { app, sessionMiddleware } from "./express/express.js";
import passport from "passport";
import chatHandler from "./socket/chat.js";
import { socketMapList, userInit } from "./socket/activeSockets";
import { pollAllReposWithPolling } from "./webhooks/polling.js";

const port = process.env.PORT || 3000;

const httpServer = createServer(app);

export const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    }
});

app.set("io", io);

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
            display_name: user.username,
            active_group: null
        });

        socket.userId = user.github_id;
        socket.username = user.username;

        console.log(`User ${user.username} connected with socket ${socket.id}`);
    } else {
        // Unauthenticated 
        userInit(socket.id, {
            authenticated: false,
            github_id: null,
            username: null,
            avatar_url: null,
            access_token: null,
            active_group: null
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

// Start background polling job for repos with use_polling = TRUE
// Polls every 60 seconds (respects GitHub's X-Poll-Interval header for faster limits)
setInterval(() => {
    pollAllReposWithPolling(io).catch(err => {
        console.error("Polling job error:", err);
    });
}, 60 * 1000); // 60 seconds

// Also run once on startup (delayed by 5 seconds to let server stabilize)
setTimeout(() => {
    pollAllReposWithPolling(io).catch(err => {
        console.error("Initial polling job error:", err);
    });
}, 5 * 1000);

// start server
httpServer.listen(port, () => {
    console.log(`Server listening at port ${port}`);
});
