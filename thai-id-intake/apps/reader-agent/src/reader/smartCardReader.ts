import { createRequire } from "node:module";
import { readerConfig } from "../config/config.js";
import { normalizeCard, SmartCardReturnData } from "./cardNormalizer.js";
import { publishCardRead } from "./cardRead.js";
import { markReaderHardwareAvailable, markReaderHardwareUnavailable, publishReaderStatus } from "./readerStatus.js";

const require = createRequire(import.meta.url);

export async function startSmartCardReader() {
  try {
    await publishReaderStatus("starting", "Thai ID reader initializing");
    const readerPackageRequire = createRequire(require.resolve("thai-id-card-reader/build/index.js"));
    const { ThaiIdCardReader } = readerPackageRequire("thai-id-card-reader/build/index.js") as {
      ThaiIdCardReader: new (options: { insertCardDelay: number; readTimeout: number }) => {
        onReadComplete: (callback: (data: Partial<SmartCardReturnData>) => void) => void;
        onReadError: (callback: (error: string) => void) => void;
        init: () => void;
      };
    };
    startReaderPresenceMonitor(readerPackageRequire);
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
    await publishReaderStatus("starting", `Thai ID reader service initialized; waiting for PC/SC reader`);
  } catch (error) {
    markReaderHardwareUnavailable("Thai ID reader package is installed, but native startup failed. Rebuild pcsclite before using hardware.");
    await publishReaderStatus(
      "error",
      `Thai ID reader package is installed, but native startup failed. Rebuild pcsclite before using hardware. ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function startReaderPresenceMonitor(readerPackageRequire: (id: string) => unknown) {
  const pcsclite = readerPackageRequire("pcsclite") as () => PcscContext;
  const pcsc = pcsclite();
  pcsc.on("reader", (reader) => {
    markReaderHardwareAvailable(`PC/SC reader detected: ${reader.name}`);
    void publishReaderStatus("ready", `PC/SC reader detected: ${reader.name}`);
    reader.on("error", (error) => {
      markReaderHardwareUnavailable(`PC/SC reader error: ${error.message}`);
      void publishReaderStatus("error", `PC/SC reader error: ${error.message}`);
    });
    reader.on("end", () => {
      markReaderHardwareUnavailable(`PC/SC reader removed: ${reader.name}`);
      void publishReaderStatus("error", `PC/SC reader removed: ${reader.name}`);
    });
  });
  pcsc.on("error", (error: Error) => {
    markReaderHardwareUnavailable(`PC/SC error: ${error.message}`);
    void publishReaderStatus("error", `PC/SC error: ${error.message}`);
  });
}

type PcscReader = {
  name: string;
  on(event: "error", callback: (error: Error) => void): void;
  on(event: "end", callback: () => void): void;
};

type PcscContext = {
  on(event: "reader", callback: (reader: PcscReader) => void): void;
  on(event: "error", callback: (error: Error) => void): void;
};
