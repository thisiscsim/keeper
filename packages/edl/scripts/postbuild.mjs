// Mark the dual-build outputs so Node resolves them without the
// MODULE_TYPELESS_PACKAGE_JSON reparse warning when scripts import @reel/edl.
import { writeFileSync } from "node:fs";

writeFileSync("dist/esm/package.json", `${JSON.stringify({ type: "module" }, null, 2)}\n`);
writeFileSync("dist/cjs/package.json", `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
