import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <div className="km-page-notfound">
      <div className="km-notice">
        <h2>{t("notFound.title")}</h2>
        <p>{t("notFound.hint")}</p>
        <Link to="/">{t("notFound.home")}</Link>
      </div>
    </div>
  );
}
