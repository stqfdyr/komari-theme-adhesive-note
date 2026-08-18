import { useTranslation } from "react-i18next";
import { PaperCard } from "@/components/paper/PaperCard";
import { useLiveData } from "@/contexts/live-data";
import { useSite } from "@/contexts/site";
import { useMediaQuery } from "@/lib/use-media-query";

/**
 * 卡片墙是多列的那一档。
 *
 * 严格取反 `.km-index-card-wall` 的单列断点（max-width: 760px）。两者之间不能
 * 留出哪怕 1px 的窗口，否则那一档里纸与版式会各按各的规则走。
 */
const MULTI_COLUMN = "not all and (max-width: 760px)";

export function IndexPage() {
  const { t } = useTranslation();
  const { nodes, loading, error } = useSite();
  const { status } = useLiveData();
  const multiColumn = useMediaQuery(MULTI_COLUMN);

  /**
   * 纸张素材只在多列下启用：单列时卡片被内容撑成竖长条，与素材画布的宽高比
   * 差四成，拉伸会把撕边咬口扯长、纤维压成竖条纹。多列下只差不到一成。
   */
  const useSheet = multiColumn;

  if (loading && nodes.length === 0) {
    return (
      <div className="km-page-index">
        <div className="km-notice">
          <p>{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (error && nodes.length === 0) {
    return (
      <div className="km-page-index">
        <div className="km-notice">
          <h2>{t("index.loadFailed")}</h2>
          <p>{error.message}</p>
        </div>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="km-page-index">
        <div className="km-notice">
          <h2>{t("index.empty")}</h2>
          <p>{t("index.emptyHint")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="km-page-index">
      <div className="km-index-card-wall">
        {nodes.map((node, index) => (
          <PaperCard
            key={node.uuid}
            node={node}
            status={status[node.uuid]}
            appearanceIndex={index}
            useSheet={useSheet}
          />
        ))}
      </div>
    </div>
  );
}
