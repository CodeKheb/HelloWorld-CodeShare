import { io } from "../server.js";
// import { 
//     socketMapList,
//     userInit
//  } from "./activeSockets.js";

export default function chatHandler(socket) {
    socket.on("client_ID", (socketId) => {
        console.log(socketId);
        
    })
}