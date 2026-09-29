// Lets tests import data files as text, e.g. `import text from "./file.yaml?raw"` (a Vite/Vitest feature).
declare module "*?raw" {
  const text: string;
  export default text;
}
