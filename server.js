import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { setupSocketHandlers } from "./src/socketHandlers.js";

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

io.on("connection", (socket) => {
  setupSocketHandlers(io, socket);
});

server.listen(PORT, () => {
  console.log("Server avviato su http://localhost:3000");
});
