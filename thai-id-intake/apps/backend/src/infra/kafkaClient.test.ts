import { describe, expect, it } from "vitest";
import { requiredTopicConfigs } from "./kafkaClient.js";

describe("backend Kafka topic config", () => {
  it("creates station-scoped topics for every configured station", () => {
    const topics = requiredTopicConfigs(["A01", "A02"]).map(({ topic }) => topic);

    expect(topics).toContain("scan.requests");
    expect(topics).toContain("reader.card-read");
    expect(topics).toContain("scan.rejections");
    expect(topics).toContain("audit.scan-events");
    expect(topics).toContain("station.status.A01");
    expect(topics).toContain("reader.status.A01");
    expect(topics).toContain("station.status.A02");
    expect(topics).toContain("reader.status.A02");
  });
});
