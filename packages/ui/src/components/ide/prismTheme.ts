import type { PrismTheme } from "prism-react-renderer";

/** OpenAI/VS Code-inspired dark syntax theme. Colors are literal (not tokens)
 *  so highlighting stays legible on the dark editor surface in both modes. */
export const auroraPrismTheme: PrismTheme = {
  plain: {
    color: "#e4e4e7",
    backgroundColor: "transparent",
  },
  styles: [
    { types: ["comment", "prolog", "cdata"], style: { color: "#6e6e80", fontStyle: "italic" } },
    { types: ["punctuation"], style: { color: "#acacbe" } },
    { types: ["property", "tag", "symbol", "deleted"], style: { color: "#f472b6" } },
    { types: ["boolean", "number", "constant"], style: { color: "#f59e0b" } },
    { types: ["selector", "attr-name", "string", "char", "inserted"], style: { color: "#5cc6a8" } },
    { types: ["operator", "entity", "url"], style: { color: "#93c5fd" } },
    { types: ["atrule", "attr-value", "keyword"], style: { color: "#7dd3fc" } },
    { types: ["function", "class-name"], style: { color: "#c4b5fd" } },
    { types: ["regex", "important", "variable"], style: { color: "#fbbf24" } },
  ],
};
