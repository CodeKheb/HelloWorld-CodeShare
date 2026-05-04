import { io } from "../server.js";
export default function chatHandler(socket) {
    socket.on("client_ID", (socketId) => {
        console.log(socketId);
        
    })

    socket.on("direct-message", (recieverId, message) => {
        if (!recieverId) {
            socket.emit("server-error", {err: "error" , reason: "No-recieverId"}) 
        }
        socket.to(recieverId).emit("server-direct-text", message)
    })

    socket.on("group-message", (groupId, message) => {
        if (!groupId) {
            socket.emit("server-error", {err: "error" , reason: "No-groupId"})
        }
        socket.to(groupId).emit("server-direct-text", message)
    })
}