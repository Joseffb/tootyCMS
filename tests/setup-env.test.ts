import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  trace: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
}));

vi.mock("@/lib/debug", () => ({
  trace: mocks.trace,
}));

const REQUIRED_RUNTIME_VALUES = {
  NEXTAUTH_URL: "https://app.example.com",
  NEXT_PUBLIC_ROOT_DOMAIN: "example.com",
  CMS_DB_PREFIX: "example_",
  POSTGRES_URL: "postgres://example",
  NEXTAUTH_SECRET: "super-secret",
};

function clearManagedRuntimeEnv() {
  delete process.env.VERCEL;
  delete process.env.VERCEL_URL;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  delete process.env.AWS_EXECUTION_ENV;
  delete process.env.NETLIFY;
  delete process.env.CF_PAGES;
  delete process.env.RAILWAY_ENVIRONMENT;
  delete process.env.RENDER;
  delete process.env.FLY_APP_NAME;
  delete process.env.SETUP_ENV_BACKEND;
  for (const key of Object.keys(REQUIRED_RUNTIME_VALUES)) {
    delete process.env[key];
  }
}

describe("setup env persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.readFile.mockReset();
    mocks.writeFile.mockReset();
    mocks.trace.mockReset();
    clearManagedRuntimeEnv();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("skips persistence on managed runtimes when required env values already exist", async () => {
    process.env.NETLIFY = "true";
    Object.assign(process.env, REQUIRED_RUNTIME_VALUES);

    const { saveSetupEnvValues } = await import("@/lib/setup-env");

    await expect(
      saveSetupEnvValues({
        ...REQUIRED_RUNTIME_VALUES,
      }),
    ).resolves.toEqual({ backend: "runtime", persisted: false });

    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips remote persistence when managed runtime env already satisfies setup even with an explicit backend", async () => {
    process.env.VERCEL = "1";
    process.env.SETUP_ENV_BACKEND = "vercel";
    Object.assign(process.env, REQUIRED_RUNTIME_VALUES);

    const { saveSetupEnvValues } = await import("@/lib/setup-env");

    await expect(saveSetupEnvValues(REQUIRED_RUNTIME_VALUES)).resolves.toEqual({
      backend: "runtime",
      persisted: false,
    });

    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed on managed runtimes when required env values are missing", async () => {
    process.env.NETLIFY = "true";
    Object.assign(process.env, {
      NEXTAUTH_URL: REQUIRED_RUNTIME_VALUES.NEXTAUTH_URL,
      NEXT_PUBLIC_ROOT_DOMAIN: REQUIRED_RUNTIME_VALUES.NEXT_PUBLIC_ROOT_DOMAIN,
      CMS_DB_PREFIX: REQUIRED_RUNTIME_VALUES.CMS_DB_PREFIX,
    });

    const { saveSetupEnvValues, SetupEnvPersistenceError } = await import("@/lib/setup-env");

    await expect(
      saveSetupEnvValues(REQUIRED_RUNTIME_VALUES),
    ).rejects.toBeInstanceOf(SetupEnvPersistenceError);

    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the Vercel env API automatically when Vercel runtime env is missing", async () => {
    process.env.VERCEL = "1";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/v9/projects/") && url.includes("/env")) {
        return {
          ok: true,
          json: async () => ({ envs: [] }),
        };
      }
      if (url.includes("/v10/projects/") && init?.method === "POST") {
        return {
          ok: true,
          text: async () => "",
        };
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { saveSetupEnvValues } = await import("@/lib/setup-env");

    await expect(
      saveSetupEnvValues({
        ...REQUIRED_RUNTIME_VALUES,
        AUTH_BEARER_TOKEN: "vercel-token",
        PROJECT_ID_VERCEL: "prj_123",
        TEAM_ID_VERCEL: "team_123",
      }),
    ).resolves.toEqual({ backend: "vercel", persisted: true });

    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/v10/projects/prj_123/env?teamId=team_123")),
    ).toBe(true);
  });

  it("skips the Vercel env API when Vercel runtime env already matches setup values", async () => {
    process.env.VERCEL = "1";
    Object.assign(process.env, REQUIRED_RUNTIME_VALUES);

    const { saveSetupEnvValues } = await import("@/lib/setup-env");

    await expect(
      saveSetupEnvValues(REQUIRED_RUNTIME_VALUES),
    ).resolves.toEqual({ backend: "runtime", persisted: false });

    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still writes .env locally when no managed runtime is detected", async () => {
    mocks.readFile.mockRejectedValue(new Error("missing"));

    const { saveSetupEnvValues } = await import("@/lib/setup-env");

    await expect(
      saveSetupEnvValues({
        NEXTAUTH_URL: REQUIRED_RUNTIME_VALUES.NEXTAUTH_URL,
        NEXT_PUBLIC_ROOT_DOMAIN: REQUIRED_RUNTIME_VALUES.NEXT_PUBLIC_ROOT_DOMAIN,
        CMS_DB_PREFIX: REQUIRED_RUNTIME_VALUES.CMS_DB_PREFIX,
        POSTGRES_URL: REQUIRED_RUNTIME_VALUES.POSTGRES_URL,
        NEXTAUTH_SECRET: REQUIRED_RUNTIME_VALUES.NEXTAUTH_SECRET,
      }),
    ).resolves.toEqual({ backend: "local", persisted: true });

    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(String(mocks.writeFile.mock.calls[0]?.[1] || "")).toContain(
      `POSTGRES_URL=${REQUIRED_RUNTIME_VALUES.POSTGRES_URL}`,
    );
  });
});
