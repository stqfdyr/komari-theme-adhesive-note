#!/usr/bin/env node
/**
 * 边界态验证。
 *
 * 节点全在线、都不临近到期时，离线卡、过期、空列表这些分支靠肉眼撞不到。
 * 这里拦截 RPC2 的响应注入构造数据，逐个走一遍降级路径。
 *
 * 顺带验证 HTTP 回退：脚本会先禁掉 WebSocket，强制客户端走 POST 通道。
 *
 * 用法：node scripts/edge-cases.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const globalRoot = execFileSync("npm", ["root", "-g"], {
      encoding: "utf-8",
    }).trim();
    return import(
      pathToFileURL(join(globalRoot, "playwright", "index.mjs")).href
    );
  }
}

const BASE = process.env.SHOT_URL ?? "http://127.0.0.1:5273";
const outDir = resolve("scratch/edge");

const now = Date.now();
const day = 86_400_000;

function isoIn(days) {
  return new Date(now + days * day).toISOString();
}

function node(overrides) {
  return {
    uuid: "00000000-0000-4000-8000-000000000001",
    name: "Sample",
    cpu_name: "Intel(R) Xeon(R) CPU E5-2697 v2 @ 2.70GHz",
    virtualization: "kvm",
    arch: "amd64",
    cpu_cores: 2,
    cpu_physical_cores: 2,
    os: "Debian GNU/Linux 12 (bookworm)",
    kernel_version: "6.1.0-52-amd64",
    gpu_name: "None",
    region: "🇺🇸",
    mem_total: 2 * 1024 ** 3,
    swap_total: 0,
    disk_total: 40 * 1024 ** 3,
    weight: 0,
    price: 9.5,
    billing_cycle: 365,
    auto_renewal: true,
    currency: "$",
    expired_at: isoIn(200),
    group: "",
    tags: "",
    hidden: false,
    traffic_limit: 0,
    traffic_limit_type: "max",
    created_at: isoIn(-30),
    updated_at: isoIn(0),
    ...overrides,
  };
}

function status(uuid, overrides) {
  return {
    client: uuid,
    time: new Date(now).toISOString(),
    cpu: 12.5,
    gpu: 0,
    ram: 700 * 1024 ** 2,
    ram_total: 2 * 1024 ** 3,
    swap: 0,
    swap_total: 0,
    load: 0.42,
    load5: 0.3,
    load15: 0.2,
    temp: 0,
    disk: 12 * 1024 ** 3,
    disk_total: 40 * 1024 ** 3,
    net_in: 12_000,
    net_out: 8_000,
    net_total_up: 63.9 * 1024 ** 3,
    net_total_down: 68.7 * 1024 ** 3,
    process: 88,
    connections: 24,
    connections_udp: 2,
    online: true,
    uptime: 7 * 86_400,
    ...overrides,
  };
}

/** 每个场景给出节点与状态 */
const SCENARIOS = {
  "offline-node": () => {
    const n = node({ name: "Offline", uuid: "aaaa0000-0000-4000-8000-000000000001" });
    return {
      nodes: [n],
      status: { [n.uuid]: status(n.uuid, { online: false, cpu: 0, load: 0, net_in: 0, net_out: 0, uptime: 0 }) },
    };
  },

  "expiry-states": () => {
    const soon = node({ name: "ExpiresSoon", uuid: "bbbb0000-0000-4000-8000-000000000001", expired_at: isoIn(3) });
    const warn = node({ name: "ExpiresWarn", uuid: "bbbb0000-0000-4000-8000-000000000002", expired_at: isoIn(21) });
    const gone = node({ name: "Expired", uuid: "bbbb0000-0000-4000-8000-000000000003", expired_at: isoIn(-5) });
    const never = node({ name: "NoExpiry", uuid: "bbbb0000-0000-4000-8000-000000000004", expired_at: "0001-01-01T00:00:00Z", price: 0 });
    // 管理员表达「长期」的做法是把到期日填到很远的将来，应与未设置到期一样显示 ∞
    const longTerm = node({ name: "LongTerm", uuid: "bbbb0000-0000-4000-8000-000000000005", expired_at: isoIn(365 * 200), price: 0 });
    const nodes = [soon, warn, gone, never, longTerm];
    return {
      nodes,
      status: Object.fromEntries(nodes.map((n) => [n.uuid, status(n.uuid)])),
    };
  },

  "empty-nodes": () => ({ nodes: [], status: {} }),

  "missing-status": () => {
    const n = node({ name: "NoStatusYet", uuid: "eeee0000-0000-4000-8000-000000000001" });
    // 节点刚加入、还没有任何状态上报
    return { nodes: [n], status: {} };
  },

  "long-name": () => {
    const n = node({
      name: "极长的节点名称用于测试溢出处理 very-long-node-name-for-overflow",
      uuid: "ffff0000-0000-4000-8000-000000000001",
      os: "Ubuntu 24.04.1 LTS (Noble Numbat) with a very long release string",
    });
    return {
      nodes: [n],
      status: { [n.uuid]: status(n.uuid, { cpu: 99.87, ram: 1.99 * 1024 ** 3, disk: 39.8 * 1024 ** 3 }) },
    };
  },
};

async function run(name, scenario, browser) {
  const data = scenario();
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 2,
  });

  // 关掉 WebSocket，强制客户端走 HTTP POST——顺便验证回退通道
  await context.addInitScript(() => {
    Object.defineProperty(window, "WebSocket", { value: undefined });
  });

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.route("**/api/rpc2", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();

    let body;
    try {
      body = JSON.parse(request.postData() ?? "{}");
    } catch {
      return route.continue();
    }

    const reply = (result) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
      });

    switch (body.method) {
      case "public:getNodesInformation":
        return reply(data.nodes);
      case "common:getNodesLatestStatus":
        return reply(data.status);
      case "public:getPublicSettings":
        return reply({
          sitename: `边界态 · ${name}`,
          description: "edge case",
          theme: "AdhesiveNote",
          private_site: false,
          record_enabled: true,
          record_preserve_time: 24,
          ping_record_preserve_time: 24,
          custom_head: "",
          custom_body: "",
          oauth_enable: false,
          oauth_provider: "",
          disable_password_login: false,
          cors_origin_check_enabled: true,
          visitor_audit_enabled: false,
        });
      default:
        return route.continue();
    }
  });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".km-node-card, .km-notice", { timeout: 12_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);

  const shot = join(outDir, `${name}.png`);
  await page.screenshot({ path: shot });

  // 卡片上不该出现 NaN / undefined / Invalid Date 这类漏网的空值
  const text = await page.evaluate(() => document.body.innerText);
  const badValues = ["NaN", "undefined", "Infinity", "Invalid Date", "[object Object]"].filter(
    (needle) => text.includes(needle),
  );

  await context.close();
  return { name, errors, badValues };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();

  let failed = 0;
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const result = await run(name, scenario, browser);
    const ok = result.errors.length === 0 && result.badValues.length === 0;
    if (!ok) failed++;

    console.log(`${ok ? "✓" : "✗"} ${name}`);
    for (const error of result.errors.slice(0, 3)) console.log(`    报错: ${error}`);
    if (result.badValues.length > 0) {
      console.log(`    页面出现异常值: ${result.badValues.join(", ")}`);
    }
  }

  await browser.close();
  console.log(
    failed === 0 ? "\n全部边界态通过" : `\n${failed} 个场景存在问题`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
