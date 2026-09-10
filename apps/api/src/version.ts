import { createRequire } from "node:module";

/** Service version, read from this package's package.json. */
const nodeRequire = createRequire(import.meta.url);
const pkg = nodeRequire("../package.json") as { version: string };

export const SERVICE_VERSION = pkg.version;
