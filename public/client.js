const socket = io();
let isReadyState = false;
let myToken = localStorage.getItem("lupus_session_token");
let myPlayerId = null;
let myRole = null;
let isAlive = true;
let currentPlayers = [];
let selectedTargetId = null;
let selectedDayTargetId = null;
let countdownInterval = null;
let isCardRevealed = false;
let swRegistration = null;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then((reg) => {
    swRegistration = reg;
  });
}

async function enablePushNotifications() {
  if (!("Notification" in window) || !swRegistration) return;
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    socket.emit("push:get_key");
  }
}

socket.on("push:key", async (data) => {
  if (!swRegistration) return;
  const sub = await swRegistration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(data.publicKey),
  });
  socket.emit("push:subscribe", { subscription: sub });
});

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

socket.on("connect", () => {
  if (myToken) {
    socket.emit("player:join", { nickname: null, sessionToken: myToken });
  }
});

window.joinGame = function () {
  const name = document.getElementById("nickname").value.trim();
  if (name) {
    socket.emit("player:join", { nickname: name, sessionToken: myToken });
  }
};

window.toggleReady = function () {
  socket.emit("player:ready", { isReady: !isReadyState });
};

window.leaveGame = function () {
  socket.emit("player:leave");
  localStorage.removeItem("lupus_session_token");
  myToken = null;
  myPlayerId = null;

  const logo = document.getElementById("mainLogo");
  if (logo) logo.classList.remove("hidden");

  document.getElementById("joinView").classList.remove("hidden");
  document.getElementById("lobbyView").classList.add("hidden");
  document.getElementById("roleView").classList.add("hidden");
  document.getElementById("nightView").classList.add("hidden");
  document.getElementById("dayView").classList.add("hidden");
  document.getElementById("gameOverView").classList.add("hidden");
};

window.toggleRoleCard = function () {
  const card = document.getElementById("roleCard");
  const instruction = document.getElementById("cardInstruction");
  const roleTitle = document.getElementById("roleTitle");

  isCardRevealed = !isCardRevealed;

  if (isCardRevealed) {
    card.classList.remove("covered");
    instruction.classList.add("hidden");
    roleTitle.classList.remove("hidden");
  } else {
    card.classList.add("covered");
    instruction.classList.remove("hidden");
    roleTitle.classList.add("hidden");
  }
};

window.submitNightAction = function () {
  if (!selectedTargetId || !isAlive) return;

  if (myRole === "LUPO") {
    socket.emit("wolves:confirm_action", { targetId: selectedTargetId });
  } else if (myRole === "VEGGENTE") {
    socket.emit("seer:action", { targetId: selectedTargetId });
  } else if (myRole === "DONNA") {
    socket.emit("bodyguard:action", { targetId: selectedTargetId });
  }

  const confirmBtn = document.getElementById("nightConfirmBtn");
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerText = "SCELTA INVIATA";
  }
};

window.submitDayVote = function () {
  if (!selectedDayTargetId || !isAlive) return;

  socket.emit("day:vote", { targetId: selectedDayTargetId });

  const confirmBtn = document.getElementById("dayConfirmBtn");
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerText = "VOTO INVIATO";
  }
};

window.returnToLobby = function () {
  socket.emit("game:restart");
};

socket.on("session:init", (data) => {
  myToken = data.sessionToken;
  myPlayerId = data.playerId;
  isAlive = true;
  localStorage.setItem("lupus_session_token", myToken);
  enablePushNotifications();

  document.getElementById("joinView").classList.add("hidden");
  document.getElementById("lobbyView").classList.remove("hidden");
  document.getElementById("readyBtn").disabled = false;
});

socket.on("game:sync_reconnect", (data) => {
  myRole = data.role;
  isAlive = data.isAlive;

  const logo = document.getElementById("mainLogo");
  if (logo) logo.classList.add("hidden");

  document.getElementById("joinView").classList.add("hidden");
  document.getElementById("lobbyView").classList.add("hidden");
  document.getElementById("roleView").classList.add("hidden");

  if (data.phase === "NIGHT") {
    document.body.classList.add("night-mode");
    document.getElementById("nightView").classList.remove("hidden");
    document.getElementById("dayView").classList.add("hidden");
    document.getElementById("gameOverView").classList.add("hidden");

    document.getElementById("nightPhaseTitle").innerText =
      `NOTTE ${data.nightNumber}`;
    document.getElementById("nightInstruction").innerText = isAlive
      ? "La città dorme..."
      : "SEI STATO ELIMINATO (Modalità Spettatore)";
  } else if (data.phase === "DAY") {
    document.body.classList.remove("night-mode");
    document.getElementById("nightView").classList.add("hidden");
    document.getElementById("dayView").classList.remove("hidden");
    document.getElementById("gameOverView").classList.add("hidden");

    document.getElementById("totalAliveCount").innerText = data.alivePlayers
      ? data.alivePlayers.length
      : "0";
    renderDayTargetList(data.alivePlayers || []);
  } else if (data.phase === "GAME_OVER") {
    document.getElementById("gameOverView").classList.remove("hidden");
  }
});

socket.on("lobby:state", (data) => {
  currentPlayers = data.players;
  document.getElementById("playerCount").innerText =
    `numero giocatori: ${currentPlayers.length}`;

  const listContainer = document.getElementById("playerList");
  listContainer.innerHTML = "";

  currentPlayers.forEach((p) => {
    let dotClass =
      p.status === "Disconnesso"
        ? "dot-red"
        : p.isReady
          ? "dot-green"
          : "dot-gray";
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `<span class="player-name">${p.nickname}</span><span class="status-dot ${dotClass}"></span>`;
    listContainer.appendChild(row);
  });

  const me = currentPlayers.find((p) => p.id === myPlayerId);
  if (me) {
    isReadyState = me.isReady;
    const readyBtn = document.getElementById("readyBtn");
    if (readyBtn) readyBtn.innerText = isReadyState ? "NOT READY" : "READY";
  }
});

socket.on("game:role", (data) => {
  myRole = data.role;
  isAlive = true;
  isCardRevealed = false;

  const logo = document.getElementById("mainLogo");
  if (logo) logo.classList.add("hidden");

  const card = document.getElementById("roleCard");
  const instruction = document.getElementById("cardInstruction");
  const roleTitle = document.getElementById("roleTitle");
  const nightCountdownContainer = document.getElementById(
    "nightCountdownContainer",
  );
  const nightTimerEl = document.getElementById("nightTimer");

  card.classList.add("covered");
  instruction.classList.remove("hidden");
  roleTitle.classList.add("hidden");
  roleTitle.innerText = myRole;

  nightCountdownContainer.classList.add("hidden");
  document.getElementById("lobbyView").classList.add("hidden");
  document.getElementById("roleView").classList.remove("hidden");

  setTimeout(() => {
    nightCountdownContainer.classList.remove("hidden");
    document.body.classList.add("night-mode");

    let timeLeft = 5;
    nightTimerEl.innerText = timeLeft;
    const roleInterval = setInterval(() => {
      timeLeft -= 1;
      if (timeLeft > 0) {
        nightTimerEl.innerText = timeLeft;
      } else {
        clearInterval(roleInterval);
      }
    }, 1000);
  }, 2000);
});

socket.on("game:phase", (data) => {
  if (data.phase === "ROLE_ASSIGNMENT") {
    const buttonsContainer = document.getElementById("lobbyButtons");
    const banner = document.getElementById("countdownBanner");
    const timerEl = document.getElementById("timer");

    if (buttonsContainer) buttonsContainer.classList.add("hidden");
    if (banner) banner.classList.remove("hidden");

    let timeLeft = data.duration;
    if (timerEl) timerEl.innerText = timeLeft;

    clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      timeLeft -= 1;
      if (timeLeft > 0) {
        if (timerEl) timerEl.innerText = timeLeft;
      } else {
        clearInterval(countdownInterval);
      }
    }, 1000);
  } else if (data.phase === "NIGHT") {
    document.body.classList.add("night-mode");
    document.getElementById("roleView").classList.add("hidden");
    document.getElementById("dayView").classList.add("hidden");
    document.getElementById("nightView").classList.remove("hidden");
    document.getElementById("nightPhaseTitle").innerText =
      `NOTTE ${data.nightNumber}`;

    document.getElementById("nightInstruction").innerText = isAlive
      ? "La città dorme... Chiudi gli occhi!"
      : "SEI STATO ELIMINATO (Modalità Spettatore)";

    document.getElementById("nightActionCard").classList.add("hidden");
    document.getElementById("nightConfirmBtn").classList.add("hidden");
  } else if (data.phase === "DAY") {
    document.body.classList.remove("night-mode");
    document.getElementById("roleView").classList.add("hidden");
    document.getElementById("nightView").classList.add("hidden");
    document.getElementById("dayView").classList.remove("hidden");

    if (data.killedPlayer && data.killedPlayer.id === myPlayerId) {
      isAlive = false;
    }

    const outcomeBanner = document.getElementById("nightOutcomeBanner");
    if (data.killedPlayer) {
      outcomeBanner.innerText = `Durante la notte è stato eliminato: ${data.killedPlayer.nickname}`;
      outcomeBanner.classList.add("killed");
    } else {
      outcomeBanner.innerText =
        "La notte è trascorsa tranquilla. Non è morto nessuno.";
      outcomeBanner.classList.remove("killed");
    }

    document.getElementById("votedCount").innerText = "0";
    document.getElementById("totalAliveCount").innerText = data.alivePlayers
      ? data.alivePlayers.length
      : "0";

    renderDayTargetList(data.alivePlayers || []);
  }
});

socket.on("night:turn_start", (data) => {
  if (!isAlive) return;

  if ("vibrate" in navigator) {
    navigator.vibrate([400, 150, 400]);
  }

  const instructionEl = document.getElementById("nightInstruction");
  const actionCard = document.getElementById("nightActionCard");
  const confirmBtn = document.getElementById("nightConfirmBtn");

  actionCard.classList.remove("hidden");
  confirmBtn.classList.remove("hidden");
  confirmBtn.disabled = true;

  const targets = data.alivePlayers || currentPlayers;

  if (data.subPhase === "NIGHT_WOLVES") {
    instructionEl.innerText = "SCEGLI LA VITTIMA";
    confirmBtn.innerText = "CONFERMA VITTIMA";
    renderTargetList(targets, (p) => p.id !== myPlayerId, "LUPO");
  } else if (data.subPhase === "NIGHT_SEER") {
    instructionEl.innerText = "SCEGLI CHI ISPEZIONARE";
    confirmBtn.innerText = "ISPEZIONA";
    renderTargetList(targets, (p) => p.id !== myPlayerId, "VEGGENTE");
  } else if (data.subPhase === "NIGHT_BODYGUARD") {
    instructionEl.innerText = "SCEGLI CHI PROTEGGERE";
    confirmBtn.innerText = "PROTEGGI";
    renderTargetList(
      targets,
      (p) => p.id !== data.lastProtectedId,
      "DONNA",
      data.lastProtectedId,
    );
  }
});

socket.on("night:turn_end", () => {
  document.getElementById("nightInstruction").innerText = isAlive
    ? "Il villaggio dorme... Chiudi gli occhi!"
    : "SEI STATO ELIMINATO (Modalità Spettatore)";
  document.getElementById("nightActionCard").classList.add("hidden");
  document.getElementById("nightConfirmBtn").classList.add("hidden");
});

socket.on("wolves:votes_update", (data) => {
  document.querySelectorAll("#nightTargetList .player-row").forEach((el) => {
    el.classList.remove("wolf-targeted");
  });

  data.votes.forEach((vote) => {
    const targetRow = document.querySelector(
      `.player-row[data-id="${vote.targetId}"]`,
    );
    if (targetRow) {
      targetRow.classList.add("wolf-targeted");
    }
  });
});

socket.on("seer:result", (data) => {
  const targetList = document.getElementById("nightTargetList");
  if (targetList) {
    targetList.innerHTML = `
      <div style="text-align:center; padding: 15px;">
        <h3 style="font-size: 1.3rem; margin-bottom: 8px;">${data.targetName}</h3>
        <div style="font-size: 1.4rem; font-weight: bold; color: ${
          data.isLupo ? "#ff3b3b" : "#00ff38"
        };">
          ${data.isLupo ? "È UN LUPO" : "NON È UN LUPO"}
        </div>
      </div>
    `;
  }
  document.getElementById("nightConfirmBtn").classList.add("hidden");
});

socket.on("day:votes_count", (data) => {
  document.getElementById("votedCount").innerText = data.votedCount;
  document.getElementById("totalAliveCount").innerText = data.totalAlive;
});

socket.on("day:result", (data) => {
  const outcomeBanner = document.getElementById("nightOutcomeBanner");
  if (data.isTie) {
    outcomeBanner.innerText =
      "ESITO VOTO: Pareggio! Nessun giocatore viene eliminato dal villaggio.";
    outcomeBanner.classList.remove("killed");
  } else if (data.eliminatedPlayer) {
    outcomeBanner.innerText = `ESITO VOTO: Il villaggio ha eliminato ${data.eliminatedPlayer.nickname}!`;
    outcomeBanner.classList.add("killed");

    if (data.eliminatedPlayer.id === myPlayerId) {
      isAlive = false;
    }
  }
  document.getElementById("dayActionCard").classList.add("hidden");
  document.getElementById("dayConfirmBtn").classList.add("hidden");
});

socket.on("game:over", (data) => {
  document.body.classList.remove("night-mode");
  document.getElementById("joinView").classList.add("hidden");
  document.getElementById("lobbyView").classList.add("hidden");
  document.getElementById("roleView").classList.add("hidden");
  document.getElementById("nightView").classList.add("hidden");
  document.getElementById("dayView").classList.add("hidden");
  document.getElementById("gameOverView").classList.remove("hidden");

  const titleEl = document.getElementById("gameOverTitle");
  const bannerEl = document.getElementById("gameOverWinnerBanner");

  if (data.winner === "WOLVES") {
    titleEl.innerText = "I LUPI VINCONO!";
    titleEl.style.color = "#ff3b3b";
    bannerEl.innerText = "I Lupi hanno divorato il villaggio!";
    bannerEl.className = "outcome-banner killed";
  } else {
    titleEl.innerText = "IL VILLAGGIO VINCE!";
    titleEl.style.color = "#00ff38";
    bannerEl.innerText = "Tutti i Lupi sono stati eliminati!";
    bannerEl.className = "outcome-banner";
  }

  const listContainer = document.getElementById("gameOverPlayerList");
  if (listContainer) {
    listContainer.innerHTML = "";
    data.players.forEach((p) => {
      const row = document.createElement("div");
      row.className = "player-row";
      row.style.opacity = p.isAlive ? "1" : "0.5";
      row.innerHTML = `
        <span class="player-name">${p.nickname} ${p.isAlive ? " (Vivo)" : " (Morto)"}</span>
        <span style="font-weight: bold; color: ${p.role === "LUPO" ? "#ff3b3b" : "#ffffff"}">${p.role}</span>
      `;
      listContainer.appendChild(row);
    });
  }
});

socket.on("game:reset", () => {
  isAlive = true;

  const logo = document.getElementById("mainLogo");
  if (logo) logo.classList.remove("hidden");

  document.body.classList.remove("night-mode");
  document.getElementById("gameOverView").classList.add("hidden");
  document.getElementById("roleView").classList.add("hidden");
  document.getElementById("nightView").classList.add("hidden");
  document.getElementById("dayView").classList.add("hidden");
  document.getElementById("lobbyView").classList.remove("hidden");

  const buttonsContainer = document.getElementById("lobbyButtons");
  const banner = document.getElementById("countdownBanner");
  if (buttonsContainer) buttonsContainer.classList.remove("hidden");
  if (banner) banner.classList.add("hidden");
});

function renderTargetList(playersList, filterFn, role, disabledId = null) {
  const targetList = document.getElementById("nightTargetList");
  if (!targetList) return;
  targetList.innerHTML = "";
  selectedTargetId = null;

  playersList.forEach((p) => {
    const isSelectable = filterFn(p);
    const row = document.createElement("div");
    row.className = `player-row ${isSelectable ? "selectable" : "disabled-row"}`;
    row.dataset.id = p.id;

    let extraText =
      p.id === disabledId ? " <small>(Protetto ieri)</small>" : "";
    row.innerHTML = `<span class="player-name">${p.nickname}${extraText}</span>`;

    if (isSelectable && isAlive) {
      row.onclick = () => {
        document
          .querySelectorAll("#nightTargetList .player-row")
          .forEach((r) => r.classList.remove("selected"));
        row.classList.add("selected");
        selectedTargetId = p.id;

        if (role === "LUPO") {
          socket.emit("wolves:select_target", { targetId: p.id });
        }
        document.getElementById("nightConfirmBtn").disabled = false;
      };
    }
    targetList.appendChild(row);
  });
}

function renderDayTargetList(alivePlayers) {
  const targetList = document.getElementById("dayTargetList");
  const confirmBtn = document.getElementById("dayConfirmBtn");
  const actionCard = document.getElementById("dayActionCard");

  if (!targetList) return;
  targetList.innerHTML = "";
  selectedDayTargetId = null;

  if (!isAlive) {
    actionCard.classList.remove("hidden");
    confirmBtn.classList.add("hidden");
    targetList.innerHTML = `
      <div style="text-align: center; padding: 15px; color: #ff3b3b; font-weight: bold;">
        SEI STATO ELIMINATO<br>
        <span style="font-size: 0.85rem; color: #aaa; font-weight: normal;">Puoi seguire la discussione ma non puoi votare.</span>
      </div>
    `;
    return;
  }

  actionCard.classList.remove("hidden");
  confirmBtn.classList.remove("hidden");
  confirmBtn.innerText = "CONFERMA VOTO";
  confirmBtn.disabled = true;

  alivePlayers.forEach((p) => {
    const row = document.createElement("div");
    row.className = "player-row selectable";
    row.dataset.id = p.id;
    row.innerHTML = `<span class="player-name">${p.nickname}</span>`;

    row.onclick = () => {
      document
        .querySelectorAll("#dayTargetList .player-row")
        .forEach((r) => r.classList.remove("selected"));
      row.classList.add("selected");
      selectedDayTargetId = p.id;

      if (confirmBtn && confirmBtn.innerText !== "VOTO INVIATO") {
        confirmBtn.disabled = false;
      }
    };

    targetList.appendChild(row);
  });
}
