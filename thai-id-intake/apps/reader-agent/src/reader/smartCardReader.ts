import { createRequire } from "node:module";
import { readerConfig } from "../config/config.js";
import { normalizeCard, SmartCardReturnData } from "./cardNormalizer.js";
import { publishCardRead } from "./cardRead.js";
import { publishReaderStatus } from "./readerStatus.js";

const require = createRequire(import.meta.url);

export async function startSmartCardReader() {
  try {
    const { ThaiIdCardReader } = require("thai-id-card-reader/build/index.js") as {
      ThaiIdCardReader: new (options: { insertCardDelay: number; readTimeout: number }) => {
        onReadComplete: (callback: (data: Partial<SmartCardReturnData>) => void) => void;
        onReadError: (callback: (error: string) => void) => void;
        init: () => void;
      };
    };
    const reader = new ThaiIdCardReader({
      insertCardDelay: readerConfig.insertCardDelayMs,
      readTimeout: readerConfig.readTimeoutMs
    });

    reader.onReadComplete((data: Partial<SmartCardReturnData>) => {
      void publishCardRead(normalizeCard(data as Record<string, unknown>));
    });
    reader.onReadError((error: string) => {
      void publishReaderStatus("read_failed_retryable", error);
    });
    reader.init();
    await publishReaderStatus("ready", `Thai ID reader initialized; insert delay ${readerConfig.insertCardDelayMs}ms`);
  } catch (error) {
    await publishReaderStatus(
      "error",
      `Thai ID reader package is installed, but native startup failed. Rebuild pcsclite before using hardware. ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
