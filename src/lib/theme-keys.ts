/** What the server and the browser both need to know about the themes. */
export type Theme = "dark" | "light";

/** Where the visitor's choice is kept. The script in the root layout reads the same key before the page is painted. */
export const THEME_KEY = "council:theme";
/** The colour of the browser's own bars, per theme. */
export const THEME_COLOR: Record<Theme, string> = { dark: "#000000", light: "#f4f4f4" };
