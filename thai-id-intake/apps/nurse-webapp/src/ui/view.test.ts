import { describe, expect, it } from "vitest";
import { isSafePhotoDataUri } from "./view";

describe("nurse result view", () => {
  it("allows only jpeg and png base64 photo data URIs", () => {
    expect(isSafePhotoDataUri("data:image/jpeg;base64,SGVsbG8=")).toBe(true);
    expect(isSafePhotoDataUri("data:image/png;base64,SGVsbG8=")).toBe(true);
    expect(isSafePhotoDataUri('x" onerror="alert(1)')).toBe(false);
    expect(isSafePhotoDataUri("javascript:alert(1)")).toBe(false);
    expect(isSafePhotoDataUri("data:image/svg+xml;base64,PHN2Zy8+")).toBe(false);
  });
});
