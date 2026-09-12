export const ROLES = {
  WEREWOLF: "LUPO",
  SEER: "VEGGENTE",
  DOCTOR: "DONNA",
  VILLAGER: "CONTADINO",
};

export function generateRolesPool(playerCount) {
  const roles = [];

  // Scalabilità Lupi in base ai partecipanti
  let wolfCount = 1;
  if (playerCount >= 7 && playerCount <= 11) {
    wolfCount = 2;
  } else if (playerCount >= 12) {
    wolfCount = 3;
  }

  for (let i = 0; i < wolfCount; i++) {
    roles.push(ROLES.WEREWOLF);
  }

  // Ruoli speciali
  roles.push(ROLES.SEER);
  if (playerCount >= 4) {
    roles.push(ROLES.DOCTOR);
  }

  // Riempimento con Contadini
  while (roles.length < playerCount) {
    roles.push(ROLES.VILLAGER);
  }

  // Fisher-Yates Shuffle
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  return roles;
}
