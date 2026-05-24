const fs = require("fs");
const path = require("path");
const { config } = require("../server/config");
const { buildPublicConfig, simulateSlotMath } = require("../server/slots");

const sampleSize = Number.parseInt(process.argv[2], 10) || 2000000;
const outputPath = path.join(__dirname, "slots-math.json");

const snapshot = {
  generatedAt: new Date().toISOString(),
  ...simulateSlotMath({
    paidSpins: sampleSize,
    betAmount: config.slotMinBet,
  }),
  targets: {
    rtp: config.slotTargetRtp,
    houseEdge: Number((100 - config.slotTargetRtp).toFixed(2)),
    hitFrequency: "28% - 35%",
    bonusFrequency: "1 / 120 - 1 / 180",
    maxWin: `x${config.slotMaxWinMultiplier}`,
  },
  configuration: buildPublicConfig(),
};

fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

console.log(`Snapshot machine a sous genere: ${outputPath}`);
console.log(`RTP simule: ${snapshot.rtp}%`);
console.log(`Hit frequency: ${snapshot.hitFrequency}%`);
console.log(`Bonus frequency: 1/${snapshot.bonusFrequency}`);
