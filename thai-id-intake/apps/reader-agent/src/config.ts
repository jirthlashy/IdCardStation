export const readerConfig = {
  stationId: process.env.STATION_ID ?? "A01",
  brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
  insertCardDelayMs: Number(process.env.INSERT_CARD_DELAY_MS ?? 500),
  readTimeoutMs: Number(process.env.READ_TIMEOUT_MS ?? 5000),
  heartbeatMs: Number(process.env.READER_HEARTBEAT_MS ?? 10000)
};

export const readerId = process.env.READER_ID ?? `${readerConfig.stationId}-PC-01`;
