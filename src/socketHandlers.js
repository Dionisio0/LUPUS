import crypto from "node:crypto";
import {
  gameState,
  MAX_PLAYERS,
  broadcastLobbyState,
  checkAutoStart,
  getVapidPublicKey,
  registerPushSubscription,
  handleWolfSelect,
  confirmWolvesAction,
  handleSeerAction,
  handleBodyguardAction,
  handleDayVote,
  resetGameToLobby,
} from "./gameState.js";

export function setupSocketHandlers(io, socket) {
  socket.on("player:join", ({ nickname, sessionToken }) => {
    let token = sessionToken;
    let player = token ? gameState.players.get(token) : null;

    if (player) {
      player.socketId = socket.id;
      player.status = "Connesso";
    } else {
      if (gameState.players.size >= MAX_PLAYERS) {
        return socket.emit("error", {
          message: `Stanza piena (max ${MAX_PLAYERS}).`,
        });
      }
      if (gameState.phase !== "LOBBY") {
        return socket.emit("error", { message: "Partita già in corso." });
      }

      const cleanName = nickname ? nickname.trim() : "";
      if (!cleanName) {
        return socket.emit("error", {
          message: "Inserisci un nickname valido.",
        });
      }

      const isNameTaken = Array.from(gameState.players.values()).some(
        (p) => p.nickname.toLowerCase() === cleanName.toLowerCase(),
      );

      if (isNameTaken) {
        return socket.emit("error", {
          message: "Nickname già in uso. Scegli un altro nome.",
        });
      }

      token = crypto.randomUUID();
      player = {
        id: crypto.randomUUID(),
        nickname: cleanName,
        socketId: socket.id,
        status: "Connesso",
        isReady: false,
        isAlive: true,
      };
      gameState.players.set(token, player);
    }

    socket.sessionToken = token;
    socket.join("global-room");

    socket.emit("session:init", { sessionToken: token, playerId: player.id });

    // RIPRISTINO STATO SE LA PARTITA È GIÀ IN CORSO
    if (gameState.phase !== "LOBBY") {
      const aliveList = Array.from(gameState.players.values())
        .filter((p) => p.isAlive)
        .map((p) => ({ id: p.id, nickname: p.nickname }));

      socket.emit("game:sync_reconnect", {
        phase: gameState.phase,
        subPhase: gameState.subPhase,
        nightNumber: gameState.nightCount,
        role: player.role,
        isAlive: player.isAlive,
        alivePlayers: aliveList,
      });
    }

    broadcastLobbyState(io);
  });

  socket.on("push:get_key", () => {
    socket.emit("push:key", { publicKey: getVapidPublicKey() });
  });

  socket.on("push:subscribe", ({ subscription }) => {
    const player = gameState.players.get(socket.sessionToken);
    if (player) {
      registerPushSubscription(player.id, subscription);
    }
  });

  socket.on("wolves:select_target", ({ targetId }) => {
    handleWolfSelect(io, socket.id, targetId);
  });

  socket.on("wolves:confirm_action", ({ targetId }) => {
    confirmWolvesAction(io, targetId);
  });

  socket.on("seer:action", ({ targetId }) => {
    handleSeerAction(io, socket.id, targetId);
  });

  socket.on("bodyguard:action", ({ targetId }) => {
    handleBodyguardAction(io, socket.id, targetId);
  });

  socket.on("day:vote", ({ targetId }) => {
    handleDayVote(io, socket.id, targetId);
  });

  socket.on("player:ready", ({ isReady }) => {
    const player = gameState.players.get(socket.sessionToken);

    if (player && gameState.phase === "LOBBY") {
      player.isReady = Boolean(isReady);
      broadcastLobbyState(io);
      checkAutoStart(io);
    }
  });

  socket.on("game:restart", () => {
    if (gameState.phase === "GAME_OVER") {
      resetGameToLobby(io);
    }
  });

  socket.on("player:leave", () => {
    const token = socket.sessionToken;

    if (token && gameState.players.has(token)) {
      if (gameState.phase === "LOBBY") {
        gameState.players.delete(token);
        socket.sessionToken = null;
        broadcastLobbyState(io);
      }
    }
  });

  socket.on("disconnect", () => {
    const token = socket.sessionToken;
    const player = gameState.players.get(token);

    if (player) {
      player.status = "Disconnesso";
      player.socketId = null;

      if (gameState.phase === "LOBBY") {
        player.isReady = false;
      }
      broadcastLobbyState(io);
    }
  });
}
