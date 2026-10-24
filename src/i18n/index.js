import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import zh from "./zh.json";
import ja from "./ja.json";

function savedLang() {
  try {
    return localStorage.getItem("lang");
  } catch {
    return null;
  }
}

const browserLang = navigator.language.split("-")[0];
const defaultLang = savedLang() || (["zh", "ja"].includes(browserLang) ? browserLang : "en");

// <html lang> picks the CJK glyphs (Chinese and Japanese forms of the same character differ).
const HTML_LANG = { en: "en", zh: "zh-CN", ja: "ja" };
i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = HTML_LANG[lng] || lng;
});

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
    ja: { translation: ja },
  },
  lng: defaultLang,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
