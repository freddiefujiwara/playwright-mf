import { describe, expect, it, vi } from "vitest";

import auth from "../auth.js";

const { getAuthPaths, persistAuthState, runAuthFlow } = auth;

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
      "Saved authentication data: /tmp/auth/auth.json"
    );
  });

  it("handles errors when persisting auth state", async () => {
    const context = { storageState: vi.fn() };
    const fsModule = {
      mkdirSync: vi.fn().mockImplementation(() => {
        throw new Error("FS error");
      }),
    };
    const logger = { log: vi.fn(), error: vi.fn() };

    await persistAuthState({
      context,
      authDir: "/tmp/auth",
      authPath: "/tmp/auth/auth.json",
      fsModule,
      logger,
    });

    expect(logger.error).toHaveBeenCalledWith(
      "Failed to save auth.json:",
      expect.any(Error)
    );
  });
});

describe("runAuthFlow", () => {
  it("should run the auth flow and persist the state", async () => {
    const page = { goto: vi.fn().mockResolvedValue(undefined) };
    const context = { newPage: vi.fn().mockResolvedValue(page) };
    const browser = {
      newContext: vi.fn().mockResolvedValue(context),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const chromiumModule = { launch: vi.fn().mockResolvedValue(browser) };
    const stdin = { resume: vi.fn(), once: vi.fn() };
    const logger = { log: vi.fn(), error: vi.fn() };
    const exit = vi.fn();
    const persistFn = vi.fn().mockResolvedValue(undefined);
    const authPaths = {
      authDir: "/tmp/auth",
      authPath: "/tmp/auth/auth.json",
    };

    await runAuthFlow({
      chromiumModule,
      stdin,
      logger,
      exit,
      authPaths,
      persistFn,
    });

    expect(chromiumModule.launch).toHaveBeenCalledWith({ headless: false });
    expect(browser.newContext).toHaveBeenCalled();
    expect(context.newPage).toHaveBeenCalled();
    expect(page.goto).toHaveBeenCalledWith(
      "https://moneyforward.com/users/sign_in"
    );
    expect(logger.log).toHaveBeenCalledWith(
      "Please complete the login process in the browser."
    );
    expect(logger.log).toHaveBeenCalledWith(
      "When you are done, please return to the terminal and press Enter..."
    );
    expect(stdin.resume).toHaveBeenCalled();
    expect(stdin.once).toHaveBeenCalledWith("data", expect.any(Function));

    // Manually trigger the stdin 'data' event callback
    const callback = stdin.once.mock.calls[0][1];
    await callback();

    expect(persistFn).toHaveBeenCalledWith({
      context,
      authDir: authPaths.authDir,
      authPath: authPaths.authPath,
      logger,
    });
    expect(browser.close).toHaveBeenCalled();
    expect(exit).toHaveBeenCalled();
  });
});
