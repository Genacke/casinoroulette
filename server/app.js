const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const path = require("path");
const { config } = require("./config");
const { startConnect4Engine } = require("./connect4");
const { initializeDatabase } = require("./db");
const { startPokerEngine } = require("./poker");
const { startRoundEngine } = require("./rounds");
const { startSkribblEngine } = require("./skribbl");
const authRoutes = require("../routes/auth.routes");
const gameRoutes = require("../routes/game.routes");
const adminRoutes = require("../routes/admin.routes");
const connect4Routes = require("../routes/connect4.routes");
const pokerRoutes = require("../routes/poker.routes");
const skribblRoutes = require("../routes/skribbl.routes");
const slotsRoutes = require("../routes/slots.routes");

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  }),
);
app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

app.use("/public", express.static(path.join(config.rootDir, "public")));
app.use("/client", express.static(path.join(config.rootDir, "client")));
app.use("/admin", express.static(path.join(config.rootDir, "admin")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(config.rootDir, "client", "index.html"));
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(config.rootDir, "admin", "index.html"));
});

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    status: "ok",
    houseEdgePercent: config.houseEdgePercent,
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/game", gameRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/connect4", connect4Routes);
app.use("/api/poker", pokerRoutes);
app.use("/api/skribbl", skribblRoutes);
app.use("/api/slots", slotsRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route introuvable.",
  });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    success: false,
    message: error.message || "Erreur interne du serveur.",
  });
});

initializeDatabase()
  .then(async () => {
    await startRoundEngine();
    await startPokerEngine();
    await startConnect4Engine();
    await startSkribblEngine();
    app.listen(config.port, () => {
      console.log(`Roulette casino en ligne sur http://localhost:${config.port}`);
    });
  })
  .catch((error) => {
    console.error("Echec au demarrage:", error);
    process.exit(1);
  });
