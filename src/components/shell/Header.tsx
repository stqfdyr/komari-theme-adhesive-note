import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { useLiveData } from "@/contexts/live-data";
import { useSite } from "@/contexts/site";

export function Header() {
  const { t } = useTranslation();
  const { settings, nodes } = useSite();
  const { status } = useLiveData();
  const location = useLocation();

  const total = nodes.length;
  const online = nodes.reduce(
    (count, node) => count + (status[node.uuid]?.online ? 1 : 0),
    0,
  );

  const isIndex = location.pathname === "/";

  return (
    <header className="km-navbar">
      <div>
        {isIndex ? (
          <h1 className="km-navbar-title">
            {settings?.sitename || t("index.title")}
          </h1>
        ) : (
          <Link to="/" className="km-navbar-title km-navbar-home">
            {settings?.sitename || t("index.title")}
          </Link>
        )}
        {total > 0 ? (
          <p className="km-navbar-subtitle km-num">
            {t("index.onlineCount", { online, total })}
          </p>
        ) : null}
      </div>

      <div className="km-navbar-actions">
        <a className="km-ui-button km-admin-link" href="/admin/dashboard">
          {t("common.admin")}
          <span aria-hidden="true">↗</span>
        </a>
      </div>
    </header>
  );
}
