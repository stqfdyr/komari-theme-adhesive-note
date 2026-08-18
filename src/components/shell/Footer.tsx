import { useTranslation } from "react-i18next";

/**
 * 页脚。`Powered by Komari Monitor.` 是主题开发文档的硬性要求，必须保留。
 */
export function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="km-footer">
      <div>{t("footer.poweredBy")}</div>
    </footer>
  );
}
