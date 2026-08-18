import { useState } from "react";
import { LOCALE } from "@/i18n";
import { flagSrc, regionLabel, regionToISO } from "@/lib/flags";

/**
 * 国旗。
 *
 * 解析不出 ISO 码、或对应 SVG 缺失时（例如管理员填了自定义地区名），
 * 回退渲染原始字符，绝不留空白。
 */
export function Flag({ region }: { region: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const iso = regionToISO(region);
  const src = iso ? flagSrc(iso) : "";

  if (!iso || src === failedSrc) {
    return region ? (
      <span className="km-flag-fallback" title={region}>
        {region}
      </span>
    ) : null;
  }

  const label = regionLabel(iso, LOCALE);

  return (
    <img
      className="km-flag"
      src={src}
      alt={label}
      title={label}
      width={48}
      draggable={false}
      loading="lazy"
      decoding="async"
      // 节点地区后来被修正时重新尝试新的资源，而不是永久停在旧失败态。
      onError={() => setFailedSrc(src)}
    />
  );
}
