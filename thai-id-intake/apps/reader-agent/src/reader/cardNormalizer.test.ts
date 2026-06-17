import { describe, expect, it } from "vitest";
import { normalizeCard } from "./cardNormalizer.js";

describe("normalizeCard", () => {
  it("normalizes alternate SmartCard field names", () => {
    expect(
      normalizeCard({
        citizenID: 12345,
        fullNameTH: "สมชาย ใจดี",
        fullNameEN: "Somchai Jaidee",
        titleTH: "นาย",
        titleEN: "Mr.",
        firstNameTH: "สมชาย",
        lastNameTH: "ใจดี"
      })
    ).toMatchObject({
      citizenId: "12345",
      fullNameTh: "สมชาย ใจดี",
      fullNameEn: "Somchai Jaidee",
      titleTh: "นาย",
      titleEn: "Mr.",
      firstNameTh: "สมชาย",
      lastNameTh: "ใจดี"
    });
  });

  it("uses supported citizen id fallbacks", () => {
    expect(normalizeCard({ cid: "111" }).citizenId).toBe("111");
    expect(normalizeCard({ personalId: "222" }).citizenId).toBe("222");
  });

  it("leaves missing optional fields undefined", () => {
    expect(normalizeCard({ citizenId: "123" })).toEqual({ citizenId: "123" });
  });
});
