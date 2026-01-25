import { describe, expect, it, vi } from "vitest";

import auth from "../auth.js";

const { getAuthPaths, persistAuthState } = auth;

describe("auth helpers", () => {
  it("builds auth paths from homedir", () => {
    const fakeHomedir = () => "/home/tester";
    const join = (...parts) => parts.join("/");

    const paths = getAuthPaths({ homedir: fakeHomedir, join });

    expect(paths).toEqual({
      authDir: "/home/tester/.config/playwright-mf",
      authPath: "/home/tester/.config/playwright-mf/auth.json",
    });
  });

  it("persists auth state with expected path", async () => {
    const context = { storageState: vi.fn().mockResolvedValue(undefined) };
    const fsModule = { mkdirSync: vi.fn() };
    const logger = { log: vi.fn(), error: vi.fn() };

    await persistAuthState({
      context,
      authDir: "/tmp/auth",
      authPath: "/tmp/auth/auth.json",
      fsModule,
      logger,
    });

    expect(fsModule.mkdirSync).toHaveBeenCalledWith("/tmp/auth", {
      recursive: true,
    });
    expect(context.storageState).toHaveBeenCalledWith({
      path: "/tmp/auth/auth.json",
    });
    expect(logger.log).toHaveBeenCalledWith(
      "認証情報を保存しました: /tmp/auth/auth.json"
    );
  });
});
