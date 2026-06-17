import { normalizeCard } from "../reader/cardNormalizer.js";
import { publishCardRead } from "../reader/cardRead.js";
import { publishReaderStatus } from "../reader/readerStatus.js";

export function registerDemoCommands() {
  process.stdin.on("data", async (chunk) => {
    const text = chunk.toString().trim();
    if (text === "demo-card-in") {
      await publishReaderStatus("card_inserted", "Demo card inserted");
    }
    if (text === "demo-card-out") {
      await publishReaderStatus("card_removed", "Demo card removed");
    }
    if (text === "demo-read-error") {
      await publishReaderStatus("read_failed_retryable", "Demo retryable read error");
    }
    if (text === "demo-read") {
      await publishCardRead(normalizeCard({ citizenId: "0000000000000", fullNameTh: "DEMO ONLY" }));
    }
  });
}
