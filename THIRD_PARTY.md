# 第三方资源与许可

本主题自身以 MIT 许可发布（见 [LICENSE](./LICENSE)）。下面列出随主题包一同分发、
或在构建期使用的第三方内容及其许可。

## 随主题包分发的资源

### 字体

| 字体 | 用途 | 许可 | 来源 |
| --- | --- | --- | --- |
| Architects Daughter | 全站唯一的拉丁手写体（标题、标签、数值、正文） | SIL Open Font License 1.1 | Kimberly Geswein，[google/fonts](https://github.com/google/fonts/tree/main/ofl/architectsdaughter) via [@fontsource/architects-daughter](https://www.npmjs.com/package/@fontsource/architects-daughter) |
| 霞鹜文楷 LXGW WenKai | 管理员填写的中文内容（站点名、节点名、自定义页脚） | SIL Open Font License 1.1 | [lxgw/LxgwWenKai](https://github.com/lxgw/LxgwWenKai) |

`public/assets/fonts/` 下的文件都是上述字体的子集：Architects Daughter 只保留 latin
子集，霞鹜文楷经 `fontTools.subset` 裁剪到 GB2312 常用字与中英文标点（见
[`scripts/subset-fonts.mjs`](./scripts/subset-fonts.mjs)）。子集化不改变原始许可，
OFL 允许在保留许可声明的前提下再分发与修改。

### 国旗图形

`public/assets/paper/flags/` 下的 258 面国旗来自 **Twemoji**。

- 仓库：<https://github.com/jdecked/twemoji>
- 代码：MIT License
- **图形：CC-BY 4.0** — 转换脚本见 [`scripts/prepare-flags.mjs`](./scripts/prepare-flags.mjs)。
  做了三件事：码点重命名为 ISO 3166-1 alpha-2、压缩空白、把 `viewBox` 从
  `0 0 36 36` 裁到 `0 5 36 26`（去掉旗面上下的透明留白，主题的飘动位移滤镜才作用得到
  旗面边缘）。图形路径本身未改动。CC-BY 4.0 允许修改后再分发，署名保留在本文件。

### 纸张素材

`src/assets/sheets/` 下的四张纸是本主题作者用 **Blender**（Cycles）
从零建模渲染的，不含任何第三方素材，随本仓库以 MIT 许可分发。

轮廓、撕边咬口、四角磨损、折痕网络、纸张厚度、翘起与投影都出自渲染，不是贴图；
两个档位（@1x / @2x）由同一份 16-bit 主渲染各自派生。主渲染约 48 MB，
不随仓库分发，派生脚本是 [`scripts/assets/make-sheets.py`](./scripts/assets/make-sheets.py)。

### 纸张纹理与文具

`public/assets/paper/textures/` 与 `public/assets/paper/stationery/` 下的素材，
派生自本主题作者自有的一张 AI 生成参考图（未随仓库分发）。作者持有该图的使用权，
派生素材随本仓库以 MIT 许可分发。

- `paper-grain.webp` / `wall-grain.webp` — 不是从参考图上裁下来的图块，而是先测出
  参考图纸面与墙面的径向功率谱，再用随机相位做逆 FFT **重新合成**的无缝纹理。
  成品与原图没有任何一块像素相同，只共享统计特征。`paper-grain.webp` 只服务程序化纸
  （单列窄屏、详情页与图表纸），墙面纹理全局使用。
- `stationery/*.png` — 六件文具（黄铜图钉、镀铬回形针、牛皮胶带、蓝和纸胶带、
  白图钉、黑长尾夹）由参考图逐件抠出，做了背景解混、墨迹剔除与投影分离。

两者的生成脚本在 [`scripts/assets/`](./scripts/assets/) 下。参考图不随仓库分发，
产物已提交入库，只有需要重新调纹理或重新抠图时才用得上这两个脚本。

### 手绘图标与笔触

`src/assets/doodle-sprite.svg` 里的全部图标，以及
[`src/components/paper/HandDrawn.tsx`](./src/components/paper/HandDrawn.tsx) 里的
进度条、分隔线、虚线与下划线，都是照着参考图的观感**重新绘制**的
SVG 路径与生成式几何，不含任何位图素材。

## 运行时依赖

| 库 | 用途 | 许可 |
| --- | --- | --- |
| [React](https://github.com/facebook/react) | UI 框架 | MIT |
| [React Router](https://github.com/remix-run/react-router) | 路由 | MIT |
| [TanStack Query](https://github.com/TanStack/query) | 数据获取与缓存 | MIT |
| [uPlot](https://github.com/leeoniya/uPlot) | 详情页时序图表 | MIT |
| [uplot-react](https://github.com/skalinichev/uplot-wrappers) | uPlot 的 React 封装 | MIT |
| [i18next](https://github.com/i18next/i18next) / [react-i18next](https://github.com/i18next/react-i18next) | 国际化 | MIT |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) | 栅格与间距工具类 | MIT |

## 设计参考（未复制代码）

### Komari RPC2 客户端

[`src/lib/rpc2.ts`](./src/lib/rpc2.ts) 是按 [JSON-RPC 2.0 规范](https://www.jsonrpc.org/specification)
与 Komari 服务端 `web/rpc/jsonrpc/transport.go` 的公开行为**独立实现**的。

官方前端 `komari-monitor/komari-web` 也有一个成熟的 RPC2 客户端，但该仓库根目录
没有 LICENSE 文件，许可状态不明确。为避免许可风险，本主题没有复制其源码，
只参考了公开文档描述的协议行为（WebSocket 优先、HTTP POST 回退、心跳保活、
指数退避重连）。

同样地，「用 RPC2 轮询替代 WebSocket 推送」「逐字段 diff 后复用旧对象引用」
「页面隐藏时暂停轮询」这几项做法参考自官方前端的公开实现思路，代码为自行编写。

### Komari

本主题为 [Komari Monitor](https://github.com/komari-monitor/komari)（MIT）开发，
遵循其[主题开发指南](https://komari-document.pages.dev/dev/theme)的约定。
Komari 本身不随主题包分发。
