// Memoria (RSS) que suma cargar cada módulo, en orden. Uso: bun scripts/mem-probe.ts "@opentui/core,../src/ui/App.tsx"
export {};
const mods = (process.argv[2] ?? "").split(",").filter(Boolean);
const mb = () => (process.memoryUsage().rss / 1048576).toFixed(1);
Bun.gc(true);
console.log("base", mb());
for (const m of mods) {
  await import(m);
  Bun.gc(true);
  console.log(m, mb());
}
