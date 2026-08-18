import { Outlet } from "react-router-dom";
import { DoodleSprite } from "@/components/paper/DoodleIcon";
import { PaperEdgeDefs } from "@/components/paper/PaperEdge";
import { Footer } from "./Footer";
import { Header } from "./Header";

/**
 * 页面外壳。
 *
 * 手绘图标 sprite 与滤镜定义在这里挂载一次，供全站所有卡片引用——
 * 每张卡片各带一份的话，定义数量会随节点数线性增长。
 */
export function Layout() {
  return (
    <div className="km-layout">
      <DoodleSprite />
      <PaperEdgeDefs />

      <Header />
      <main className="km-main">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
