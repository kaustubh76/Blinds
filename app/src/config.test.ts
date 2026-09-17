import { describe, expect, it } from "vitest";
import { resolveSettings, wsUrlFor } from "./config";

describe("runtime settings", () => {
  it("hosted defaults point at devnet with no admin service", () => {
    const r = resolveSettings({ search: "", saved: {}, env: {}, hosted: true });
    expect(r.cluster).toBe("devnet");
    expect(r.rpcUrl).toBe("https://api.devnet.solana.com");
    expect(r.adminUrl).toBe("");
    expect(r.wsUrl).toBe("wss://api.devnet.solana.com");
    expect(r.source).toEqual({ rpc: "default", admin: "default", ws: "default" });
  });

  it("dev defaults point at a local validator and admin service", () => {
    const r = resolveSettings({ search: "", saved: {}, env: {}, hosted: false });
    expect(r.cluster).toBe("localnet");
    expect(r.rpcUrl).toBe("http://127.0.0.1:8899");
    expect(r.adminUrl).toBe("http://127.0.0.1:9090");
    expect(r.wsUrl).toBe("ws://127.0.0.1:8900");
  });

  it("URL parameters beat saved settings, which beat the build env", () => {
    const r = resolveSettings({
      search: "?admin=https://abc.trycloudflare.com/&rpc=https://rpc.example",
      saved: { adminUrl: "http://saved", wsUrl: "wss://saved-ws" },
      env: { rpcUrl: "https://env", adminUrl: "https://env-admin", cluster: "devnet" },
      hosted: true,
    });
    expect(r.adminUrl).toBe("https://abc.trycloudflare.com");
    expect(r.rpcUrl).toBe("https://rpc.example");
    expect(r.wsUrl).toBe("wss://saved-ws");
    expect(r.source).toEqual({ rpc: "url", admin: "url", ws: "saved" });
    expect(r.fromUrl).toEqual({ adminUrl: "https://abc.trycloudflare.com", rpcUrl: "https://rpc.example" });
  });

  it("an empty ?admin= deliberately disables the admin service", () => {
    const r = resolveSettings({ search: "?admin=", saved: {}, env: { adminUrl: "https://env-admin" }, hosted: true });
    expect(r.adminUrl).toBe("");
    expect(r.source.admin).toBe("url");
  });

  it("derives the WebSocket endpoint, with the local validator's port", () => {
    expect(wsUrlFor("https://api.devnet.solana.com")).toBe("wss://api.devnet.solana.com");
    expect(wsUrlFor("http://127.0.0.1:8899")).toBe("ws://127.0.0.1:8900");
    expect(wsUrlFor("https://rpc.example/path?k=1")).toBe("wss://rpc.example/path?k=1");
  });
});
