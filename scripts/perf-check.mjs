#!/usr/bin/env node
/**
 * 性能压测：多节点下的轮询开销。
 *
 * 验证的是本主题最核心的一项性能设计——LiveDataContext 逐字段 diff 后复用旧对象引用，
 * 配合 PaperCard 的 memo，让「数值没变的卡片」在每 2 秒的轮询里被整张跳过。
 *
 * 默认注入 N 个节点、只让其中 1 个的数值变化；也可用 --all-moving 模拟
 * 所有节点同时变化的最坏场景。
 *
 * 用法：
 *   node scripts/perf-check.mjs            # 30 节点
 *   node scripts/perf-check.mjs --nodes 60 --seconds 30
 *   node scripts/perf-check.mjs --all-moving # 最坏情况：所有卡片每轮都变化
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
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

function parseArgs(argv) {
  const args = {
    nodes: 30,
    seconds: 20,
    url: process.env.SHOT_URL ?? "http://127.0.0.1:5273",
    real: false,
    allMoving: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--nodes") args.nodes = Number(argv[++i]);
    else if (argv[i] === "--seconds") args.seconds = Number(argv[++i]);
    else if (argv[i] === "--url") args.url = argv[++i];
    else if (argv[i] === "--real") args.real = true;
    else if (argv[i] === "--all-moving") args.allMoving = true;
  }
  return args;
}

function buildNodes(count) {
  const regions = ["🇺🇸", "🇯🇵", "🇭🇰", "🇸🇬", "🇩🇪", "🇬🇧", "🇰🇷", "🇳🇱"];
  return Array.from({ length: count }, (_, i) => ({
    uuid: `perf0000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    name: `Node-${String(i + 1).padStart(2, "0")}`,
    cpu_name: "Intel(R) Xeon(R) CPU E5-2697 v2 @ 2.70GHz",
    virtualization: "kvm",
    arch: "amd64",
    cpu_cores: 2,
    cpu_physical_cores: 2,
    os: "Debian GNU/Linux 12 (bookworm)",
    kernel_version: "6.1.0-52-amd64",
    gpu_name: "None",
    region: regions[i % regions.length],
    mem_total: 2 * 1024 ** 3,
    swap_total: 0,
    disk_total: 40 * 1024 ** 3,
    weight: i,
    price: 9.5,
    billing_cycle: 365,
    auto_renewal: true,
    currency: "$",
    expired_at: new Date(Date.now() + (30 + i) * 86_400_000).toISOString(),
    group: "",
    tags: "",
    hidden: false,
    traffic_limit: 0,
    traffic_limit_type: "max",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const nodes = buildNodes(args.nodes);

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1680, height: 941 } });

  /**
   * 注入模式下要禁掉 WebSocket，让客户端走 HTTP POST，否则下面的 route 拦不住请求。
   *
   * 注意 route.fulfill 经 CDP 把响应喂回浏览器，这条路径本身有约 100ms 的固定开销，
   * 会盖过真正的渲染成本。要看真实性能请用 --real：不拦截、不禁 WS，直接连后端。
   */
  if (!args.real) {
    await context.addInitScript(() => {
      Object.defineProperty(window, "WebSocket", { value: undefined });
    });
  }

  const page = await context.newPage();

  let statusCalls = 0;

  if (!args.real) await page.route("**/api/rpc2", async (route) => {
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

    if (body.method === "public:getNodesInformation") return reply(nodes);
    if (body.method === "public:getPublicSettings") {
      return reply({
        sitename: `压测 · ${nodes.length} 节点`,
        description: "perf",
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
    }
    if (body.method === "common:getNodesLatestStatus") {
      statusCalls++;
      const tick = statusCalls;
      const status = {};
      for (const [index, node] of nodes.entries()) {
        // 默认只有第一个节点在动；--all-moving 会模拟最坏情况。
        // diff + memo 生效时，不变节点不应引起任何重渲染。
        const moving = args.allMoving || index === 0;
        status[node.uuid] = {
          client: node.uuid,
          time: new Date().toISOString(),
          cpu: moving ? (tick * 7) % 100 : 12.5,
          gpu: 0,
          ram: moving ? 700 * 1024 ** 2 + tick * 1024 ** 2 : 700 * 1024 ** 2,
          ram_total: 2 * 1024 ** 3,
          swap: 0,
          swap_total: 0,
          load: moving ? (tick % 10) / 10 : 0.42,
          load5: 0.3,
          load15: 0.2,
          temp: 0,
          disk: 12 * 1024 ** 3,
          disk_total: 40 * 1024 ** 3,
          net_in: moving ? 12_000 + tick * 100 : 12_000,
          net_out: 8_000,
          net_total_up: 63.9 * 1024 ** 3,
          net_total_down: 68.7 * 1024 ** 3,
          process: 88,
          connections: 24,
          connections_udp: 2,
          online: true,
          uptime: 7 * 86_400,
        };
      }
      return reply(status);
    }
    return route.continue();
  });

  const session = await context.newCDPSession(page);
  await session.send("Performance.enable");

  /**
   * 采集 long task（单个任务 > 50ms）。
   *
   * 这才是「会不会掉帧」的直接指标：累计 CPU 时间高不一定卡，
   * 但一个 50ms 以上的任务必然阻塞主线程、吃掉三帧以上。
   */
  await page.addInitScript(() => {
    const w = window;
    w.__longTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          w.__longTasks.push(Math.round(entry.duration));
        }
      }).observe({ entryTypes: ["longtask"] });
    } catch {
      // 浏览器不支持 longtask 时留空数组
    }
  });

  await page.goto(args.url, { waitUntil: "networkidle" });
  await page.waitForSelector(".km-node-card");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);

  const readMetrics = async () => {
    const { metrics } = await session.send("Performance.getMetrics");
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  };

  const cardCount = await page.evaluate(
    () => document.querySelectorAll(".km-node-card").length,
  );

  // 第一段：正常轮询
  await page.evaluate(() => {
    window.__longTasks = [];
  });
  const beforeActive = await readMetrics();
  const callsBeforeActive = statusCalls;
  await page.waitForTimeout(args.seconds * 1000);
  const afterActive = await readMetrics();
  const longTasks = await page.evaluate(() => window.__longTasks ?? []);
  // --real 模式下拦不到请求，按 2 秒的轮询间隔估算轮次
  const polls = args.real
    ? Math.round((args.seconds * 1000) / 2000)
    : statusCalls - callsBeforeActive;

  /**
   * 第二段：把页面切到后台。
   *
   * 这既能测出「不轮询时的基线开销」（纸张滤镜的重绘、GC 等本来就有的成本），
   * 又顺带验证了 visibilitychange 暂停确实生效——若没生效，下面的 idlePolls 不会是 0。
   */
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  const beforeIdle = await readMetrics();
  const callsBeforeIdle = statusCalls;
  await page.waitForTimeout(args.seconds * 1000);
  const afterIdle = await readMetrics();
  const idlePolls = args.real ? 0 : statusCalls - callsBeforeIdle;

  // 恢复前台后应立即补取一次，验证暂停不是“永久停摆”。
  let resumedPolls = 0;
  if (!args.real) {
    const callsBeforeResume = statusCalls;
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        value: false,
        configurable: true,
      });
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(500);
    resumedPolls = statusCalls - callsBeforeResume;
  }

  const delta = (a, b, key) => (b[key] ?? 0) - (a[key] ?? 0);
  const activeTask = delta(beforeActive, afterActive, "TaskDuration") * 1000;
  const idleTask = delta(beforeIdle, afterIdle, "TaskDuration") * 1000;
  // 净开销 = 有轮询时的总耗时 - 同样时长下的静止基线
  const pollCost = Math.max(0, activeTask - idleTask);

  const workload = args.allMoving ? "全量变化" : "单节点变化";
  console.log(
    `\n压测结果（${cardCount} 个节点 / ${workload} / 每段 ${args.seconds} 秒）`,
  );
  console.log("-".repeat(60));
  console.log(`轮询次数     前台 ${polls} 次${args.real ? "（估算）" : ` · 后台 ${idlePolls} 次`}`);
  console.log(`脚本执行     ${(delta(beforeActive, afterActive, "ScriptDuration") * 1000).toFixed(0)} ms`);
  console.log(
    `布局计算     ${(delta(beforeActive, afterActive, "LayoutDuration") * 1000).toFixed(0)} ms` +
      `  (${delta(beforeActive, afterActive, "LayoutCount")} 次)`,
  );
  console.log(
    `样式重算     ${(delta(beforeActive, afterActive, "RecalcStyleDuration") * 1000).toFixed(0)} ms` +
      `  (${delta(beforeActive, afterActive, "RecalcStyleCount")} 次)`,
  );
  console.log(`JS 堆占用    ${(afterIdle.JSHeapUsedSize / 1024 / 1024).toFixed(1)} MB`);
  console.log("-".repeat(60));
  console.log(`前台总耗时   ${activeTask.toFixed(0)} ms  (CPU ${((activeTask / 1000 / args.seconds) * 100).toFixed(1)}%)`);
  console.log(`静止基线     ${idleTask.toFixed(0)} ms  (CPU ${((idleTask / 1000 / args.seconds) * 100).toFixed(1)}%)`);
  console.log(`轮询净开销   ${pollCost.toFixed(0)} ms 合计`);

  const perPoll = polls > 0 ? pollCost / polls : 0;
  console.log(`每轮净开销   ${perPoll.toFixed(1)} ms（含合成、GC 等非轮询活动）`);
  const worstTask = longTasks.length > 0 ? Math.max(...longTasks) : 0;
  // Long Task 的 50ms 以内本来就是一帧任务；只把超出的部分计入阻塞时间（TBT）。
  const blockingTime = longTasks.reduce(
    (total, duration) => total + Math.max(0, duration - 50),
    0,
  );
  console.log(
    `长任务       ${longTasks.length} 个` +
      (longTasks.length > 0
        ? `，最长 ${worstTask} ms · 总阻塞 ${blockingTime} ms`
        : "（无 >50ms 的阻塞任务）"),
  );
  console.log("-".repeat(60));

  /**
   * 判据同时约束 CPU 占用和 Total Blocking Time：只数 long task 个数会把 51ms
   * 与 500ms 视为同一件事，也会被 CDP route 注入响应的固定抖动误导。TBT 只累计
   * 每个任务超过 50ms 的部分，更接近用户真正丢掉的可交互时间。
   */
  const cpuShare = (activeTask / 1000 / args.seconds) * 100;
  const blockingBudget = args.seconds * 5;
  const framesOk = blockingTime <= blockingBudget && cpuShare < 15;
  const pauseOk = args.real || idlePolls === 0;
  const resumeOk = args.real || resumedPolls >= 1;
  console.log(
    framesOk
      ? `✓ 无持续的主线程阻塞（CPU ${cpuShare.toFixed(1)}%，TBT ${blockingTime} ms）`
      : `✗ 存在主线程阻塞（CPU ${cpuShare.toFixed(1)}%，TBT ${blockingTime} ms / 预算 ${blockingBudget} ms）`,
  );
  console.log(
    args.real
      ? "· --real 模式下观测不到请求次数，暂停行为请用默认模式验证"
      : pauseOk
        ? "✓ 页面隐藏后已停止轮询"
        : `✗ 页面隐藏后仍在轮询（${idlePolls} 次）`,
  );
  if (!args.real) {
    console.log(
      resumeOk
        ? "✓ 页面恢复可见后立即恢复轮询"
        : "✗ 页面恢复可见后没有恢复轮询",
    );
  }

  await browser.close();
  process.exitCode = framesOk && pauseOk && resumeOk ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
