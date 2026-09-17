import webPush from "web-push";
import { generateRolesPool, ROLES } from "./roles.js";

export const MAX_PLAYERS = 15;
export const MIN_PLAYERS = 4;

// Le chiavi VAPID devono restare le stesse a ogni riavvio del server:
// se cambiano, tutte le subscription push già salvate dai client diventano
// invalide e le notifiche smettono di arrivare finché non si ri-iscrivono.
let vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
};

if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
  console.warn(
    "[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY non impostate nelle variabili " +
      "d'ambiente: genero una coppia temporanea valida solo per questa sessione " +
      "del server. Le notifiche push smetteranno di funzionare al prossimo riavvio. " +
      "Esegui `npx web-push generate-vapid-keys` e imposta le due variabili d'ambiente " +
      "per risolvere in modo permanente.",
  );
  vapidKeys = webPush.generateVAPIDKeys();
}

webPush.setVapidDetails(
  "mailto:admin@lupusgame.com",
  vapidKeys.publicKey,
  vapidKeys.privateKey,
);

export const gameState = {
  phase: "LOBBY",
  subPhase: null,
  nightCount: 0,
  players: new Map(),
  pushSubscriptions: new Map(),
  nightActions: {
    wolvesTarget: null,
    wolvesVotes: new Map(),
    seerTarget: null,
    protectedPlayerId: null,
  },
  dayVotes: new Map(),
};

let nightTimer = null;

export function getVapidPublicKey() {
  return vapidKeys.publicKey;
}

export function registerPushSubscription(playerId, subscription) {
  gameState.pushSubscriptions.set(playerId, subscription);
}

function notifyPlayerTurn(player, title, message) {
  const sub = gameState.pushSubscriptions.get(player.id);
  if (sub) {
    webPush
      .sendNotification(
        sub,
        JSON.stringify({
          title: title,
          body: message,
          vibrate: [400, 150, 400],
        }),
      )
      .catch((err) => {
        if (err.statusCode === 404 || err.statusCode === 410) {
          // Subscription scaduta o revocata dal browser: la rimuoviamo,
          // il client dovrà ri-registrarsi (succede in automatico al
          // prossimo "session:init").
          console.warn(
            `[push] Subscription non più valida per il player ${player.id}, la rimuovo.`,
          );
          gameState.pushSubscriptions.delete(player.id);
        } else {
          console.error(
            `[push] Invio fallito per il player ${player.id} (status ${err.statusCode}):`,
            err.body || err.message || err,
          );
        }
      });
  } else {
    console.warn(
      `[push] Nessuna subscription push registrata per il player ${player.id}: notifica non inviata.`,
    );
  }
}

export function broadcastLobbyState(io) {
  const playersList = Array.from(gameState.players.values()).map((p) => ({
    id: p.id,
    nickname: p.nickname,
    status: p.status,
    isReady: p.isReady,
    isAlive: p.isAlive,
  }));

  io.to("global-room").emit("lobby:state", { players: playersList });
}

export function checkAutoStart(io) {
  const players = Array.from(gameState.players.values());
  const allReady =
    players.length >= MIN_PLAYERS && players.every((p) => p.isReady);

  if (allReady && gameState.phase === "LOBBY") {
    gameState.phase = "ROLE_ASSIGNMENT";
    const countdownDuration = 3;

    io.to("global-room").emit("game:phase", {
      phase: "ROLE_ASSIGNMENT",
      duration: countdownDuration,
    });

    setTimeout(() => {
      assignRoles(io);
    }, countdownDuration * 1000);
  }
}

export function assignRoles(io) {
  const playersList = Array.from(gameState.players.values());
  const rolesPool = generateRolesPool(playersList.length);

  playersList.forEach((player, index) => {
    player.role = rolesPool[index];
    player.isAlive = true;
    player.lastProtectedId = null;

    if (player.socketId) {
      io.to(player.socketId).emit("game:role", { role: player.role });
    }
  });

  setTimeout(() => {
    startNightSequence(io);
  }, 7000);
}

export function startNightSequence(io) {
  clearTimeout(nightTimer);
  gameState.phase = "NIGHT";
  gameState.nightCount += 1;
  gameState.nightActions = {
    wolvesTarget: null,
    wolvesVotes: new Map(),
    seerTarget: null,
    protectedPlayerId: null,
  };

  io.to("global-room").emit("game:phase", {
    phase: "NIGHT",
    nightNumber: gameState.nightCount,
  });

  setTimeout(() => {
    startWolvesPhase(io);
  }, 2000);
}

function startWolvesPhase(io) {
  gameState.subPhase = "NIGHT_WOLVES";
  clearTimeout(nightTimer);

  const alivePlayers = Array.from(gameState.players.values())
    .filter((p) => p.isAlive)
    .map((p) => ({ id: p.id, nickname: p.nickname }));

  const aliveWolves = Array.from(gameState.players.values()).filter(
    (p) => p.isAlive && p.role === ROLES.WEREWOLF,
  );

  if (aliveWolves.length === 0) {
    setTimeout(() => startSeerPhase(io), 3000);
    return;
  }

  aliveWolves.forEach((wolf) => {
    notifyPlayerTurn(wolf, "SVEGLIATI!", "Tocca ai Lupi scegliere la vittima.");
    if (wolf.socketId) {
      io.to(wolf.socketId).emit("night:turn_start", {
        subPhase: "NIGHT_WOLVES",
        alivePlayers: alivePlayers,
      });
    }
  });

  nightTimer = setTimeout(() => {
    startSeerPhase(io);
  }, 20000);
}

export function handleWolfSelect(io, socketId, targetId) {
  if (gameState.subPhase !== "NIGHT_WOLVES") return;

  gameState.nightActions.wolvesVotes.set(socketId, targetId);
  const aliveWolves = Array.from(gameState.players.values()).filter(
    (p) => p.isAlive && p.role === ROLES.WEREWOLF,
  );

  const currentVotes = Array.from(
    gameState.nightActions.wolvesVotes.entries(),
  ).map(([sId, tId]) => ({
    wolfId: Array.from(gameState.players.values()).find(
      (p) => p.socketId === sId,
    )?.id,
    targetId: tId,
  }));

  aliveWolves.forEach((w) => {
    if (w.socketId) {
      io.to(w.socketId).emit("wolves:votes_update", { votes: currentVotes });
    }
  });
}

export function confirmWolvesAction(io, targetId) {
  if (gameState.subPhase !== "NIGHT_WOLVES") return;
  clearTimeout(nightTimer);
  gameState.nightActions.wolvesTarget = targetId;

  const aliveWolves = Array.from(gameState.players.values()).filter(
    (p) => p.isAlive && p.role === ROLES.WEREWOLF,
  );
  aliveWolves.forEach((wolf) => {
    if (wolf.socketId) {
      io.to(wolf.socketId).emit("night:turn_end");
    }
  });

  setTimeout(() => {
    startSeerPhase(io);
  }, 2000);
}

function startSeerPhase(io) {
  gameState.subPhase = "NIGHT_SEER";
  clearTimeout(nightTimer);

  const alivePlayers = Array.from(gameState.players.values())
    .filter((p) => p.isAlive)
    .map((p) => ({ id: p.id, nickname: p.nickname }));

  const seer = Array.from(gameState.players.values()).find(
    (p) => p.isAlive && p.role === ROLES.SEER,
  );

  if (!seer) {
    setTimeout(() => startBodyguardPhase(io), 3000);
    return;
  }

  notifyPlayerTurn(seer, "SVEGLIATI!", "Scegli chi ispezionare.");
  if (seer.socketId) {
    io.to(seer.socketId).emit("night:turn_start", {
      subPhase: "NIGHT_SEER",
      alivePlayers: alivePlayers,
    });
  }

  nightTimer = setTimeout(() => {
    startBodyguardPhase(io);
  }, 20000);
}

export function handleSeerAction(io, socketId, targetId) {
  if (gameState.subPhase !== "NIGHT_SEER") return;
  clearTimeout(nightTimer);

  const targetPlayer = Array.from(gameState.players.values()).find(
    (p) => p.id === targetId,
  );
  const isLupo = targetPlayer ? targetPlayer.role === ROLES.WEREWOLF : false;

  io.to(socketId).emit("seer:result", {
    targetName: targetPlayer ? targetPlayer.nickname : "",
    isLupo: isLupo,
  });

  setTimeout(() => {
    io.to(socketId).emit("night:turn_end");
    setTimeout(() => {
      startBodyguardPhase(io);
    }, 2000);
  }, 2000);
}

function startBodyguardPhase(io) {
  gameState.subPhase = "NIGHT_BODYGUARD";
  clearTimeout(nightTimer);

  const alivePlayers = Array.from(gameState.players.values())
    .filter((p) => p.isAlive)
    .map((p) => ({ id: p.id, nickname: p.nickname }));

  const bodyguard = Array.from(gameState.players.values()).find(
    (p) => p.isAlive && (p.role === ROLES.DOCTOR || p.role === "DONNA"),
  );

  if (!bodyguard) {
    setTimeout(() => resolveNight(io), 3000);
    return;
  }

  notifyPlayerTurn(bodyguard, "SVEGLIATI!", "Scegli chi proteggere stanotte.");
  if (bodyguard.socketId) {
    io.to(bodyguard.socketId).emit("night:turn_start", {
      subPhase: "NIGHT_BODYGUARD",
      lastProtectedId: bodyguard.lastProtectedId || null,
      alivePlayers: alivePlayers,
    });
  }

  nightTimer = setTimeout(() => {
    resolveNight(io);
  }, 20000);
}

export function handleBodyguardAction(io, socketId, targetId) {
  if (gameState.subPhase !== "NIGHT_BODYGUARD") return;

  const bodyguard = Array.from(gameState.players.values()).find(
    (p) => p.socketId === socketId,
  );

  if (bodyguard && bodyguard.lastProtectedId === targetId) {
    io.to(socketId).emit("error", {
      message:
        "Non puoi proteggere la stessa persona per due notti consecutive!",
    });
    return;
  }

  clearTimeout(nightTimer);
  if (bodyguard) bodyguard.lastProtectedId = targetId;
  gameState.nightActions.protectedPlayerId = targetId;

  io.to(socketId).emit("night:turn_end");

  setTimeout(() => {
    resolveNight(io);
  }, 2000);
}

function resolveNight(io) {
  clearTimeout(nightTimer);
  gameState.subPhase = null;
  gameState.phase = "DAY";
  gameState.dayVotes.clear();

  const victimId = gameState.nightActions.wolvesTarget;
  const protectedId = gameState.nightActions.protectedPlayerId;
  let killedPlayer = null;

  if (victimId && victimId !== protectedId) {
    const victim = Array.from(gameState.players.values()).find(
      (p) => p.id === victimId,
    );
    if (victim) {
      victim.isAlive = false;
      killedPlayer = victim;
    }
  }

  if (!checkWinCondition(io)) {
    const alivePlayers = Array.from(gameState.players.values())
      .filter((p) => p.isAlive)
      .map((p) => ({ id: p.id, nickname: p.nickname }));

    io.to("global-room").emit("game:phase", {
      phase: "DAY",
      killedPlayer: killedPlayer
        ? { id: killedPlayer.id, nickname: killedPlayer.nickname }
        : null,
      alivePlayers: alivePlayers,
    });
  }
}

export function handleDayVote(io, socketId, targetId) {
  if (gameState.phase !== "DAY") return;

  const voter = Array.from(gameState.players.values()).find(
    (p) => p.socketId === socketId,
  );
  if (!voter || !voter.isAlive) return;

  const target = Array.from(gameState.players.values()).find(
    (p) => p.id === targetId && p.isAlive,
  );
  if (!target) return;

  gameState.dayVotes.set(voter.id, target.id);

  const alivePlayers = Array.from(gameState.players.values()).filter(
    (p) => p.isAlive,
  );

  io.to("global-room").emit("day:votes_count", {
    votedCount: gameState.dayVotes.size,
    totalAlive: alivePlayers.length,
  });

  if (gameState.dayVotes.size >= alivePlayers.length) {
    tallyDayVotes(io);
  }
}

function tallyDayVotes(io) {
  const voteCounts = new Map();

  for (const targetId of gameState.dayVotes.values()) {
    voteCounts.set(targetId, (voteCounts.get(targetId) || 0) + 1);
  }

  let maxVotes = 0;
  let eliminatedId = null;
  let isTie = false;

  for (const [targetId, count] of voteCounts.entries()) {
    if (count > maxVotes) {
      maxVotes = count;
      eliminatedId = targetId;
      isTie = false;
    } else if (count === maxVotes) {
      isTie = true;
    }
  }

  let eliminatedPlayer = null;
  if (!isTie && eliminatedId) {
    const player = Array.from(gameState.players.values()).find(
      (p) => p.id === eliminatedId,
    );
    if (player) {
      player.isAlive = false;
      eliminatedPlayer = player;
    }
  }

  io.to("global-room").emit("day:result", {
    eliminatedPlayer: eliminatedPlayer
      ? { id: eliminatedPlayer.id, nickname: eliminatedPlayer.nickname }
      : null,
    isTie: isTie,
  });

  setTimeout(() => {
    if (!checkWinCondition(io)) {
      startNightSequence(io);
    }
  }, 5000);
}

export function checkWinCondition(io) {
  const alivePlayers = Array.from(gameState.players.values()).filter(
    (p) => p.isAlive,
  );
  const aliveWolves = alivePlayers.filter((p) => p.role === ROLES.WEREWOLF);
  const aliveVillagers = alivePlayers.filter((p) => p.role !== ROLES.WEREWOLF);

  let winner = null;

  if (aliveWolves.length === 0) {
    winner = "VILLAGE";
  } else if (aliveWolves.length >= aliveVillagers.length) {
    winner = "WOLVES";
  }

  if (winner) {
    gameState.phase = "GAME_OVER";

    io.to("global-room").emit("game:over", {
      winner: winner,
      players: Array.from(gameState.players.values()).map((p) => ({
        id: p.id,
        nickname: p.nickname,
        role: p.role,
        isAlive: p.isAlive,
      })),
    });
    return true;
  }

  return false;
}

export function resetGameToLobby(io) {
  gameState.phase = "LOBBY";
  gameState.subPhase = null;
  gameState.nightCount = 0;
  gameState.nightActions = {
    wolvesTarget: null,
    wolvesVotes: new Map(),
    seerTarget: null,
    protectedPlayerId: null,
  };
  gameState.dayVotes.clear();

  gameState.players.forEach((player) => {
    player.isReady = false;
    player.isAlive = true;
    player.role = null;
    player.lastProtectedId = null;
  });

  io.to("global-room").emit("game:reset");
  broadcastLobbyState(io);
}
