import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, UnsecuredJWT } from "jose";
import { sessionCookieOptions, signSession, verifySession } from "./session";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-value-at-least-32-bytes-long!!";
});

/** Mirrors session.ts's own (unexported) secret() — used only here to
 *  hand-craft edge-case tokens that signSession's public API cannot produce
 *  (expired, malformed, wrong algorithm, missing/invalid sub). */
function testSecret(): Uint8Array {
  return new TextEncoder().encode(process.env.AUTH_SECRET!);
}

describe("session cookie", () => {
  it("round-trips the claims it was given", async () => {
    const token = await signSession({
      email: "simon@apmgservices.com.au",
      name: "Simon",
      viewAs: null,
    });
    const claims = await verifySession(token);
    expect(claims?.email).toBe("simon@apmgservices.com.au");
    expect(claims?.name).toBe("Simon");
    expect(claims?.viewAs).toBeNull();
  });

  it("preserves a valid viewAs role", async () => {
    const token = await signSession({ email: "kane@apmgservices.com.au", viewAs: "sales" });
    expect((await verifySession(token))?.viewAs).toBe("sales");
  });

  it("drops a viewAs value that is not a real role", async () => {
    const token = await signSession({
      email: "kane@apmgservices.com.au",
      // @ts-expect-error deliberately invalid, simulating a tampered payload
      viewAs: "superuser",
    });
    expect((await verifySession(token))?.viewAs).toBeNull();
  });

  it("rejects a tampered token", async () => {
    const token = await signSession({ email: "simon@apmgservices.com.au" });
    const tampered = `${token.slice(0, -4)}AAAA`;
    expect(await verifySession(tampered)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSession({ email: "simon@apmgservices.com.au" });
    process.env.AUTH_SECRET = "a-completely-different-secret-value-32b!!";
    const result = await verifySession(token);
    process.env.AUTH_SECRET = "test-secret-value-at-least-32-bytes-long!!";
    expect(result).toBeNull();
  });

  it("rejects undefined and garbage", async () => {
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession("not-a-jwt")).toBeNull();
  });

  it("round-trips the picture claim", async () => {
    const token = await signSession({
      email: "simon@apmgservices.com.au",
      picture: "https://lh3.googleusercontent.com/a/example",
    });
    const claims = await verifySession(token);
    expect(claims?.picture).toBe("https://lh3.googleusercontent.com/a/example");
  });

  it("trims and lowercases the email into sub", async () => {
    const token = await signSession({ email: "  Simon@APMGServices.com.au  " });
    const claims = await verifySession(token);
    expect(claims?.email).toBe("simon@apmgservices.com.au");
  });

  it("rejects an expired token", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("simon@apmgservices.com.au")
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(testSecret());
    expect(await verifySession(token)).toBeNull();
  });

  it("rejects a token with no sub claim", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(testSecret());
    expect(await verifySession(token)).toBeNull();
  });

  it("rejects a token whose sub is not a string", async () => {
    const token = await new SignJWT({
      // @ts-expect-error deliberately invalid, simulating a tampered payload
      sub: 12345,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(testSecret());
    expect(await verifySession(token)).toBeNull();
  });

  it("rejects a token asserting alg: none", async () => {
    const token = new UnsecuredJWT({})
      .setSubject("simon@apmgservices.com.au")
      .setIssuedAt()
      .setExpirationTime("1h")
      .encode();
    expect(await verifySession(token)).toBeNull();
  });

  it("rejects a token signed with a different algorithm (HS384)", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS384" })
      .setSubject("simon@apmgservices.com.au")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(testSecret());
    expect(await verifySession(token)).toBeNull();
  });
});

describe("sessionCookieOptions", () => {
  it("returns the expected cookie attributes", () => {
    const opts = sessionCookieOptions();
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBe(43200);
  });
});
