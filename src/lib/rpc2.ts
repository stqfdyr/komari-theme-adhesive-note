/**
 * Komari RPC2 客户端。
 *
 * 按 JSON-RPC 2.0 规范与 Komari 服务端 `web/rpc/jsonrpc/transport.go` 的行为自行实现：
 * `GET /api/rpc2` 升级为 WebSocket，`POST /api/rpc2` 走单次 HTTP。
 *
 * 传输策略：WebSocket 建连成功后优先走 WS（复用连接、低延迟）；未连接、连接中或
 * 发送失败时回退 HTTP POST。WS 请求超时会自动用 HTTP 重试一次，让调用方无感。
 *
 * 本文件为独立实现，未复制 komari-web 的源码（该仓库未提供 LICENSE），
 * 设计参考见 THIRD_PARTY.md。
 */

const RPC_PATH = "/api/rpc2";

/**
 * WebSocket.readyState 的取值。
 *
 * 有意用字面量而不是 `WebSocket.OPEN`：企业代理、受限 WebView 等环境里
 * 全局 WebSocket 可能根本不存在，读它的静态属性会直接抛 TypeError，
 * 把整个数据层带崩——而这类环境恰恰是最需要 HTTP 回退能正常工作的。
 */
const WS_CONNECTING = 0;
const WS_OPEN = 1;

/** 请求超时（毫秒） */
const REQUEST_TIMEOUT = 30_000;
/** 心跳间隔（毫秒） */
const HEARTBEAT_INTERVAL = 15_000;
/** 重连次数上限，超过后只走 HTTP */
const MAX_RECONNECT_ATTEMPTS = 5;
/** 重连基准退避（毫秒） */
const RECONNECT_BASE_DELAY = 1_000;

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface RpcResponse<T> {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: T;
  error?: RpcError;
}

export class RpcCallError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(error: RpcError) {
    super(error.message);
    this.name = "RpcCallError";
    this.code = error.code;
    this.data = error.data;
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

function rpcHttpUrl(): string {
  return RPC_PATH;
}

function rpcWsUrl(): string {
  const { protocol, host } = window.location;
  const scheme = protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${host}${RPC_PATH}`;
}

class Rpc2Client {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private suspended =
    typeof document !== "undefined" && document.visibilityState === "hidden";
  /** 浏览器环境才建连；SSR / 测试环境直接走 HTTP */
  private readonly canUseWs =
    typeof window !== "undefined" && typeof WebSocket !== "undefined";

  constructor() {
    if (this.canUseWs && !this.suspended) this.connect();
  }

  /** 调用一个 RPC 方法。WS 可用时走 WS，否则回退 HTTP。 */
  async call<T>(method: string, params: unknown = {}): Promise<T> {
    if (this.socket?.readyState === WS_OPEN) {
      try {
        return await this.callViaSocket<T>(method, params);
      } catch (error) {
        // 协议层错误（服务端明确返回 error）直接抛给调用方，不做 HTTP 重试
        if (error instanceof RpcCallError) throw error;
        return this.callViaHttp<T>(method, params);
      }
    }
    return this.callViaHttp<T>(method, params);
  }

  private callViaSocket<T>(method: string, params: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const socket = this.socket;
      if (!socket || socket.readyState !== WS_OPEN) {
        reject(new Error("websocket not open"));
        return;
      }

      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc timeout: ${method}`));
      }, REQUEST_TIMEOUT);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      try {
        socket.send(
          JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        );
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private async callViaHttp<T>(method: string, params: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(rpcHttpUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 携带 session_token cookie，私有站点与 common:* 方法需要
        credentials: "include",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: this.nextId++,
          method,
          params,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`rpc http ${response.status}: ${method}`);
      }

      const payload = (await response.json()) as RpcResponse<T>;
      if (!payload || typeof payload !== "object" || payload.jsonrpc !== "2.0") {
        throw new Error(`invalid rpc response: ${method}`);
      }
      if (payload.error) throw new RpcCallError(payload.error);
      if (!("result" in payload)) {
        throw new Error(`rpc response missing result: ${method}`);
      }
      return payload.result as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private connect(): void {
    if (!this.canUseWs || this.suspended) return;
    if (
      this.socket &&
      (this.socket.readyState === WS_OPEN ||
        this.socket.readyState === WS_CONNECTING)
    ) {
      return;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(rpcWsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      if (!this.suspended) this.startHeartbeat();
    };

    socket.onmessage = (event) => this.handleMessage(event);

    socket.onerror = () => {
      // onclose 会紧随其后触发，重连逻辑集中在那里
    };

    socket.onclose = () => {
      this.stopHeartbeat();
      if (this.socket === socket) this.socket = null;
      this.failAllPending(new Error("websocket closed"));
      this.scheduleReconnect();
    };
  }

  private handleMessage(event: MessageEvent): void {
    let payload: RpcResponse<unknown> | RpcResponse<unknown>[];
    try {
      payload = JSON.parse(String(event.data));
    } catch {
      return;
    }

    const items = Array.isArray(payload) ? payload : [payload];
    for (const item of items) {
      if (!item || typeof item !== "object" || item.jsonrpc !== "2.0") continue;
      if (typeof item.id !== "number") continue;
      const entry = this.pending.get(item.id);
      if (!entry) continue;

      this.pending.delete(item.id);
      clearTimeout(entry.timer);

      if (item.error) entry.reject(new RpcCallError(item.error));
      else entry.resolve(item.result);
    }
  }

  /** 连接断开时让在途请求快速失败，交由上层（call / react-query）回退重试 */
  private failAllPending(reason: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(reason);
    }
    this.pending.clear();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      const socket = this.socket;
      if (socket?.readyState !== WS_OPEN) return;
      try {
        // 心跳是 JSON-RPC notification，不创建请求 id、超时定时器和 pending 项。
        socket.send(
          JSON.stringify({ jsonrpc: "2.0", method: "rpc.ping", params: {} }),
        );
      } catch {
        // 发送失败后浏览器会触发 close；重连统一由 onclose 接管。
      }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.suspended) return;
    if (this.reconnectTimer !== null) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;

    const attempt = this.reconnectAttempts++;
    const delay = Math.min(RECONNECT_BASE_DELAY * 2 ** attempt, 30_000);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** 页面隐藏时暂停心跳与重连；保留已建立连接，以便返回前台时立即复用。 */
  pause(): void {
    this.suspended = true;
    this.stopHeartbeat();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** 页面重新可见时恢复心跳；若连接已断则重置退避并立即重连。 */
  resume(): void {
    if (!this.canUseWs) return;
    this.suspended = false;
    if (this.socket?.readyState === WS_OPEN) {
      this.startHeartbeat();
      return;
    }
    this.reconnectAttempts = 0;
    this.connect();
  }
}

/** 全应用共享的单例客户端 */
export const rpc2 = new Rpc2Client();

/** 便捷调用入口 */
export function rpcCall<T>(method: string, params: unknown = {}): Promise<T> {
  return rpc2.call<T>(method, params);
}
