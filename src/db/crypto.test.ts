import { describe, expect, it } from "vitest";
import { decryptText, encryptText, isEncrypted } from "./crypto";

describe("encrypted backups", () => {
  it("round-trips with the right passphrase and refuses a wrong one or tampering", async () => {
    const text = JSON.stringify({ hello: "₹1,23,456", big: "x".repeat(100_000) });
    const enc = await encryptText(text, "correct horse");
    expect(isEncrypted(JSON.parse(JSON.stringify(enc)))).toBe(true);
    expect(enc.data).not.toContain("hello");
    expect(await decryptText(enc, "correct horse")).toBe(text);
    expect(await decryptText(enc, "wrong")).toBeNull();
    const tampered = { ...enc, data: enc.data.slice(0, -4) + (enc.data.endsWith("AAAA") ? "BBBB" : "AAAA") };
    expect(await decryptText(tampered, "correct horse")).toBeNull();
  });
});
