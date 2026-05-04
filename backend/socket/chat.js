import { io } from "../server.js";
import { socketMapList } from "./activeSockets";

export default function chatHandler(socket) {
    let clientState = socketMapList.get(socket.id)

    socket.on("client_ID", (socketId) => {
        console.log(socketId);
        
    })

    socket.on("client-message", (message) => {
        if (!message) {
            socket.emit("server-error", {err: "error" , reason: "No-message-recieved"}) 
            return
        }

        if (clientState.active_directed_recieverId !== null) {
            socket.to(clientState.active_directed_recieverId).emit("server-direct-text", message)
        } 

        if (clientState.active_group !== null) {
            socket.to(clientState.active_group).emit("server-group-text", message)
        } 

    })

    socket.on("join-group", (groupId) => {
        socket.leave(clientState.active_directed_recieverId)
        clientState.active_directed_recieverId = null

        clientState.active_group = groupId
        socket.join(groupId)

        console.log(socket.rooms);
        
        console.log(clientState);
    })

    socket.on("direct-connect", (recieverId) => {
        socket.leave(clientState.active_group)
        clientState.active_group = null

        clientState.active_directed_recieverId = recieverId
        socket.join(recieverId)

        console.log(socket.rooms);

        console.log(clientState);
        
    })
}