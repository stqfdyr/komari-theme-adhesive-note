/**
 * Komari 数据类型定义。
 *
 * 全部字段基于 Komari 1.4.3（hash bf6b45e）的真实响应核对，
 * 与 `dev/rpc.md` 文档有出入之处以实测为准，并在注释中标注。
 */

/** 节点静态信息，来自 `public:getNodesInformation` */
export interface KomariNode {
  uuid: string;
  name: string;
  cpu_name: string;
  virtualization: string;
  arch: string;
  cpu_cores: number;
  cpu_physical_cores: number;
  os: string;
  kernel_version: string;
  gpu_name: string;
  /** 地区，返回的是 regional indicator 字符，如 "🇺🇸" */
  region: string;
  mem_total: number;
  swap_total: number;
  disk_total: number;
  weight: number;
  price: number;
  billing_cycle: number;
  auto_renewal: boolean;
  currency: string;
  /** ISO8601；未设置到期时后端返回零值时间（0001-01-01...） */
  expired_at: string;
  group: string;
  tags: string;
  hidden: boolean;
  traffic_limit: number;
  traffic_limit_type: string;
  created_at: string;
  updated_at: string;
  public_remark?: string;
}

/**
 * 节点实时状态，来自 `common:getNodesLatestStatus`。
 *
 * 注意这是**扁平结构**（`cpu` 而非 `cpu.usage`），与旧版 WebSocket 的嵌套结构不同。
 * `uptime` 在文档表格中未列出，但实测确实返回。
 */
export interface NodeStatus {
  client: string;
  time: string;
  /** CPU 使用率百分比（0-100） */
  cpu: number;
  gpu: number;
  ram: number;
  ram_total: number;
  swap: number;
  swap_total: number;
  load: number;
  load5: number;
  load15: number;
  temp: number;
  disk: number;
  disk_total: number;
  /** 瞬时入网速（字节/秒） */
  net_in: number;
  /** 瞬时出网速（字节/秒） */
  net_out: number;
  net_total_up: number;
  net_total_down: number;
  /** 服务端存在 net_total_out / net_total_up 两种命名，适配层统一 */
  net_total_out?: number;
  net_total_down_alt?: number;
  process: number;
  connections: number;
  connections_udp: number;
  online: boolean;
  /** 运行时长（秒） */
  uptime: number;
}

export type NodeStatusMap = Record<string, NodeStatus>;

/**
 * `public:getClientRecentRecords` 返回的短时原始上报。
 *
 * 与 latest status / 历史记录不同，这个兼容接口保留 agent 的嵌套结构；
 * 官方详情页用它为“实时”图表补齐打开页面之前的一小段曲线。
 */
export interface RecentReport {
  uuid: string;
  cpu?: { usage?: number };
  ram?: { total?: number; used?: number };
  swap?: { total?: number; used?: number };
  load?: { load1?: number; load5?: number; load15?: number };
  disk?: { total?: number; used?: number };
  network?: {
    up?: number;
    down?: number;
    totalUp?: number;
    totalDown?: number;
  };
  connections?: { tcp?: number; udp?: number };
  uptime?: number;
  process?: number;
  updated_at: string;
}

/** 站点公开设置，来自 `public:getPublicSettings` */
export interface PublicSettings {
  sitename: string;
  description: string;
  theme: string;
  theme_settings?: Record<string, unknown> | null;
  private_site: boolean;
  record_enabled: boolean;
  record_preserve_time: number;
  ping_record_preserve_time: number;
  custom_head: string;
  custom_body: string;
  oauth_enable: boolean;
  oauth_provider: string;
  disable_password_login: boolean;
  cors_origin_check_enabled: boolean;
  visitor_audit_enabled: boolean;
}

/** 服务端版本，来自 `public:getVersion` */
export interface VersionInfo {
  version: string;
  hash: string;
}

/**
 * 历史负载记录，来自 `public:getRecordsByUUID`。
 *
 * ⚠️ 陷阱：`ram_total` 与 `disk_total` 在历史记录里恒为 0，
 * 计算百分比必须改用节点静态信息的 `mem_total` / `disk_total`。
 */
export interface LoadRecord {
  client: string;
  time: string;
  cpu: number;
  gpu: number;
  ram: number;
  ram_total: number;
  swap: number;
  swap_total: number;
  load: number;
  temp: number;
  disk: number;
  disk_total: number;
  net_in: number;
  net_out: number;
  net_total_up: number;
  net_total_down: number;
  /** 该采样区间内的上行流量增量（字节） */
  traffic_up?: number;
  traffic_down?: number;
  process: number;
  connections: number;
  connections_udp: number;
}

export interface LoadRecordsResp {
  count: number;
  records: LoadRecord[];
  has_gpu_data?: boolean;
  gpu_devices?: string[];
}

/** 单条 Ping 记录 */
export interface PingRecord {
  task_id: number;
  time: string;
  /** 延迟毫秒；负值代表失败 */
  value: number;
  client: string;
}

/** `getPingRecords` 返回的任务摘要 */
export interface PingRecordTask {
  id: number;
  name: string;
  type: string;
  interval: number;
  default_on: boolean;
  total: number;
  loss: number;
  min: number;
  max: number;
  avg: number;
}

export interface PingRecordsResp {
  count: number;
  records: PingRecord[];
  tasks?: PingRecordTask[];
  basic_info?: unknown;
}

export type LoadType =
  | "cpu"
  | "gpu"
  | "ram"
  | "swap"
  | "load"
  | "temp"
  | "disk"
  | "network"
  | "process"
  | "connections"
  | "all";
