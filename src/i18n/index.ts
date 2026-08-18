import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";

/**
 * 主题只发英文一种语言。
 *
 * 仍然走 i18next 而不是把文案内联进组件：文案集中在 `locales/` 下一个 JSON 里，
 * fork 时加一门语言只需要加一个文件。相应地没有语言检测、没有 localStorage、
 * 没有 cookie——只有一种语言时那些分支只会制造语言属性与实际内容的失配。
 */
export const LOCALE = "en";

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: LOCALE,
  fallbackLng: LOCALE,
  supportedLngs: [LOCALE],
  interpolation: { escapeValue: false },
  returnNull: false,
});

/**
 * Komari 服务端会按 `language` cookie 替换 `index.html` 里的 `<html lang>`。
 * 这里显式写回 en，避免访客浏览器上遗留的 cookie 让页面自称另一种语言。
 */
document.documentElement.lang = LOCALE;

export default i18n;
