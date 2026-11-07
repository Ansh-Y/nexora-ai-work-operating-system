import type { Config } from "tailwindcss";
const config: Config = { content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"], theme: { extend: { colors: { ink: "#15191E", muted: "#75808D", line: "#E7E9EC", canvas: "#F7F8F9", brand: "#6759D8", lime: "#DDF26F" }, boxShadow: { soft: "0 8px 30px rgba(24,30,40,.05)" } } }, plugins: [] };
export default config;
