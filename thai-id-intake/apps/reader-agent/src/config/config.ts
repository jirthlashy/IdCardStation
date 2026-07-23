import { parseReaderEnv } from "./validation.js";

const env = parseReaderEnv();

export const readerConfig = {
  stationId: env.STATION_ID,
  brokers: env.KAFKA_BROKERS,
  insertCardDelayMs: env.INSERT_CARD_DELAY_MS,
  readTimeoutMs: env.READ_TIMEOUT_MS,
  heartbeatMs: env.READER_HEARTBEAT_MS,
  enableDemoCommands: env.ENABLE_DEMO_COMMANDS
};

export const readerId = env.READER_ID ?? `${readerConfig.stationId}-PC-01`;
