import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
const extension = await import("../subscription-usage.ts");
const root = mkdtempSync(join(tmpdir(), "claude-code-usage-"));

after(() => rmSync(root, { recursive: true, force: true }));

const body = {
    five_hour: { utilization: 25, resets_at: "2026-10-23T00:00:00Z" },
    seven_day: { utilization: 60 },
};

async function fixture(
    t: TestContext,
    credentials: unknown = {
        claudeAiOauth: { accessToken: "fake-bridge-token", expiresAt: Date.now() + 60_000 },
    },
) {
    const directory = mkdtempSync(join(root, "credentials-"));
    const oldConfigDir = process.env.CLAUDE_CONFIG_DIR;

    process.env.CLAUDE_CONFIG_DIR = directory;

    if (credentials !== undefined) {
        writeFileSync(
            join(directory, ".credentials.json"),
            typeof credentials === "string" ? credentials : JSON.stringify(credentials),
        );
    }

    const authCalls: string[] = [];
    const requests: {
        url: string;
        authorization: string | null;
        redirect: RequestRedirect | undefined;
    }[] = [];

    t.mock.method(ModelRuntime, "create", async () => ({
        getAuth: async (provider: string) => {
            authCalls.push(provider);
            return provider === "anthropic" ? { auth: { apiKey: "fake-pi-token" } } : undefined;
        },
    }));
    t.mock.method(childProcess, "spawn", () => {
        throw new Error("spawn must not be needed by these tests");
    });
    syncBuiltinESMExports();
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({
            url: String(url),
            authorization: new Headers(init?.headers).get("authorization"),
            redirect: init?.redirect,
        });
        return Response.json(body);
    });

    let usageHandler!: (request: { query: URLSearchParams; signal?: AbortSignal }) => unknown;
    let command!: {
        description: string;
        scope: string;
        handler: (args: string, context: any) => unknown;
    };
    const dispose: (() => unknown)[] = [];

    extension.default(undefined, {
        route: (method: string, path: string, handler: typeof usageHandler) => {
            assert.equal(method, "GET");
            assert.equal(path, "usage");
            usageHandler = handler;
        },
        command: (name: string, definition: typeof command) => {
            assert.equal(name, "usage-plans");
            command = definition;
        },
        client: () => {},
        error: (status: number, message: string) => Object.assign(new Error(message), { status }),
        onDispose: (run: () => unknown) => dispose.push(run),
    });

    t.after(async () => {
        await Promise.all(dispose.map((run) => run()));
        t.mock.restoreAll();
        syncBuiltinESMExports();
        if (oldConfigDir === undefined) {
            delete process.env.CLAUDE_CONFIG_DIR;
        } else {
            process.env.CLAUDE_CONFIG_DIR = oldConfigDir;
        }
        rmSync(directory, { recursive: true, force: true });
    });

    return {
        authCalls,
        requests,
        read: (source?: string) =>
            Promise.resolve(
                usageHandler({ query: new URLSearchParams(source ? { claude: source } : {}) }),
            ),
        command: () => command,
    };
}

function reportFor(response: any, id: string) {
    const report = response.reports.find((entry: any) => entry.id === id);
    assert.ok(report, `missing report ${id}`);
    return report;
}

test("bridge usage reads the Claude Code token only for the fixed Anthropic endpoint", async (t) => {
    const f = await fixture(t);
    const response: any = await f.read("bridge");
    const report = reportFor(response, "claude-bridge");

    assert.equal(report.ok, true);
    assert.equal(report.limits[0].percent, 25);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].url, "https://api.anthropic.com/api/oauth/usage");
    assert.equal(f.requests[0].authorization, "Bearer fake-bridge-token");
    assert.equal(f.requests[0].redirect, "error");
    assert.equal(f.authCalls.includes("anthropic"), false);
    assert.equal(JSON.stringify(response).includes("fake-bridge-token"), false);
});

test("Pi and bridge reads use separate credentials and separate caches", async (t) => {
    const f = await fixture(t);
    const [pi, bridge] = (await Promise.all([f.read(), f.read("bridge")])) as any[];

    assert.ok(reportFor(pi, "anthropic").ok);
    assert.ok(reportFor(bridge, "claude-bridge").ok);
    await f.read();
    await f.read("bridge");
    const anthropic = f.requests.filter(
        (request) => request.url === "https://api.anthropic.com/api/oauth/usage",
    );

    assert.deepEqual(anthropic.map((request) => request.authorization).sort(), [
        "Bearer fake-bridge-token",
        "Bearer fake-pi-token",
    ]);
    assert.ok(f.authCalls.includes("anthropic"));
});

for (const [label, credentials] of [
    ["invalid JSON", "not-json"],
    ["missing access token", { claudeAiOauth: { expiresAt: Date.now() + 60_000 } }],
    ["expired token", { claudeAiOauth: { accessToken: "fake-expired-token", expiresAt: 1 } }],
    [
        "non-numeric expiry",
        { claudeAiOauth: { accessToken: "fake-malformed-token", expiresAt: "tomorrow" } },
    ],
] as const) {
    test(`bridge ${label} fails without an Anthropic request or token leak`, async (t) => {
        const f = await fixture(t, credentials);
        const response: any = await f.read("bridge");
        const report = reportFor(response, "claude-bridge");

        assert.equal(report.ok, false);
        assert.equal(f.requests.length, 0);
        assert.equal(JSON.stringify(response).includes("fake-expired-token"), false);
        assert.equal(JSON.stringify(response).includes("fake-malformed-token"), false);
    });
}

test("usage-plans bridge selects Claude Code while default and pi select Pi", async (t) => {
    const f = await fixture(t);
    const cmd = f.command();
    const result = (args: string) => cmd.handler(args, { signal: new AbortController().signal });

    assert.equal(cmd.scope, "global");
    const bridge = (await result("bridge")) as any;
    assert.match(bridge.output, /Claude Code|Claude Bridge/);
    assert.equal(f.requests[0].authorization, "Bearer fake-bridge-token");

    const pi = (await result("pi")) as any;
    assert.match(pi.output, /Claude \(Anthropic\)/);
    assert.ok(f.requests.some((request) => request.authorization === "Bearer fake-pi-token"));
    const defaultResult = (await result("")) as any;
    assert.match(defaultResult.output, /Claude \(Anthropic\)/);
});

test("stopping a command does not cancel a read that the page can share", async (t) => {
    const f = await fixture(t);
    let release!: () => void;
    let started!: () => void;
    const seen = new Promise<void>((resolve) => {
        started = resolve;
    });

    t.mock.method(globalThis, "fetch", async () => {
        const waiting = new Promise<void>((resolve) => {
            release = resolve;
        });

        started();
        await waiting;

        return Response.json(body);
    });

    const stop = new AbortController();
    const command = f.command().handler("bridge", { signal: stop.signal });

    await seen;
    stop.abort(new Error("caller stopped"));
    await assert.rejects(Promise.resolve(command), /caller stopped/);
    release();

    const response = await f.read("bridge");

    assert.ok(reportFor(response, "claude-bridge").ok);
});

test("an already stopped command reads no credentials", async (t) => {
    const f = await fixture(t);
    const stop = new AbortController();

    stop.abort(new Error("already stopped"));
    await assert.rejects(
        Promise.resolve(f.command().handler("bridge", { signal: stop.signal })),
        /already stopped/,
    );
    assert.equal(f.authCalls.length, 0);
    assert.equal(f.requests.length, 0);
});

test("usage-plans rejects unsupported arguments before reading credentials", async (t) => {
    const f = await fixture(t);
    const cmd = f.command();

    await assert.rejects(
        Promise.resolve(cmd.handler("bridge unexpected", { signal: new AbortController().signal })),
        /Use \/usage-plans/,
    );
    assert.equal(f.authCalls.length, 0);
    assert.equal(f.requests.length, 0);
});
