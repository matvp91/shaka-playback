import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = dirname(fileURLToPath(import.meta.url));

export function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), "utf-8");
}
