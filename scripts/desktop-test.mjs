import { _electron as electron, expect } from "@playwright/test";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Uses the existing backend and an isolated MySQL test database, never a mock login.
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const serverRoot = path.resolve(root, "../server");
const envFile = parseEnv(await readFile(path.join(serverRoot, ".env"), "utf8"));
const databaseUrl = process.env.TEST_DATABASE_URL || envFile.TEST_DATABASE_URL;
if (
  !databaseUrl?.startsWith("mysql://") ||
  !new URL(databaseUrl).pathname.endsWith("_test")
)
  throw new Error(
    "TEST_DATABASE_URL must point to a migrated MySQL database ending in _test.",
  );
const requireServer = createRequire(path.join(serverRoot, "package.json"));
const { PrismaClient } = requireServer("@prisma/client");
const { createApp } = await import("../../server/dist/app.js");
const { loadConfig } = await import("../../server/dist/config.js");
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const { app, auth, realtime } = createApp(
  db,
  loadConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl }),
  { async send() {} },
);
const server = createServer(app);
const email = `desktop-${randomUUID()}@example.com`;
const password = "desktop-test-password!";
let desktop;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  realtime.attach(server);
  const env = {
    ...process.env,
    MARIONET_BE_URL: `http://127.0.0.1:${server.address().port}`,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MARIONET_DEV_URL;
  desktop = await electron.launch({
    args: [
      ".",
      "--enable-logging=stderr",
      `--user-data-dir=${path.join(root, ".local", "desktop-test-profile")}`,
    ],
    cwd: root,
    env,
  });
  const page = await desktop.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const settled = () =>
    expect(page.locator(".page-view[inert]")).toHaveCount(0);
  await mkdir(path.join(root, ".local"), { recursive: true });
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: path.join(root, ".local/host-login.png") });
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await settled();
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByLabel("비밀번호 확인", { exact: true }).fill(password);
  await page.getByRole("button", { name: "계정 만들기", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "가입을 환영해요!" }),
  ).toBeVisible();
  await settled();
  await page.getByRole("button", { name: "로그인하러 가기" }).click();
  await settled();
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "이 PC의 연결을 관리하세요" }),
  ).toBeVisible();
  await settled();
  await page.getByRole("button", { name: "이 PC 등록", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("이메일 인증");
  // Verify only this isolated test account, after testing the real API restriction.
  await db.user.update({
    where: { email },
    data: { emailVerifiedAt: new Date() },
  });
  await page.getByRole("button", { name: "이 PC 등록", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "이 PC 등록", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("호스트 이름", { exact: true }).fill("내 작업용 PC");
  await page.getByRole("button", { name: "변경", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("이름을 변경");
  const node = await db.node.findFirstOrThrow({ where: { user: { email } } });
  expect(node.name).toBe("내 작업용 PC");
  await page.getByRole("switch", { name: "연결 허용" }).click();
  await expect.poll(() => realtime.isOnline(node.id)).toBe(true);
  await expect(page.locator(".status")).toContainText("온라인");
  expect(
    await page.evaluate(async () =>
      JSON.stringify(await window.marioNet.getSession()),
    ),
  ).not.toContain("accessToken");
  const snapshot = await page.evaluate(() => window.marioNet.hostState());
  expect(JSON.stringify(snapshot)).not.toContain("nodeKey");
  await page.screenshot({ path: path.join(root, ".local/host-main.png") });
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(920, 640),
  );
  await page.screenshot({ path: path.join(root, ".local/host-compact.png") });
  await page.getByRole("switch", { name: "연결 허용" }).click();
  await expect.poll(() => realtime.isOnline(node.id)).toBe(false);
  await page.reload();
  await expect(page.getByLabel("호스트 이름", { exact: true })).toHaveValue(
    "내 작업용 PC",
  );
  await page.getByRole("switch", { name: "연결 허용" }).click();
  await expect.poll(() => realtime.isOnline(node.id)).toBe(true);
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
  await expect.poll(() => realtime.isOnline(node.id)).toBe(false);
  expect(errors).toEqual([]);
  console.log(
    "Host desktop integration passed: signup, login, verification gate, registration, rename, live WebSocket online/offline, reload and logout.",
  );
} finally {
  if (desktop) await desktop.close();
  await realtime.stop();
  await new Promise((resolve) => server.close(resolve));
  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
}
