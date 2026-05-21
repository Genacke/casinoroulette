const { hashPassword } = require("../server/auth");
const { initializeDatabase, get, run } = require("../server/db");

const demoUsers = [
  { username: "Roublard", password: "DofusRoulette1!", balance: 120000 },
  { username: "Enutrof", password: "DofusRoulette1!", balance: 85000 },
  { username: "Sacrieur", password: "DofusRoulette1!", balance: 64000 },
];

async function seed() {
  await initializeDatabase();

  for (const demoUser of demoUsers) {
    const existing = await get("SELECT id FROM users WHERE username = ?", [
      demoUser.username,
    ]);

    if (existing) {
      continue;
    }

    const passwordHash = await hashPassword(demoUser.password);
    await run(
      `
        INSERT INTO users (username, password_hash, role, balance)
        VALUES (?, ?, 'player', ?)
      `,
      [demoUser.username, passwordHash, demoUser.balance],
    );
  }

  console.log("Seed terminee. Utilisateurs de demo disponibles.");
  process.exit(0);
}

seed().catch((error) => {
  console.error("Seed en erreur:", error);
  process.exit(1);
});
