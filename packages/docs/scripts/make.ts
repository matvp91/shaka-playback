import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IConfigFile } from "@microsoft/api-extractor";
import { Extractor, ExtractorConfig } from "@microsoft/api-extractor";

const docsDir = resolve(import.meta.dirname, "..");
const cmafLiteDir = resolve(docsDir, "../cmaf-lite");
const tempDir = resolve(docsDir, ".temp");
const refDir = resolve(docsDir, "src/content/docs/reference");

const entryPoints = [
  { name: "cmaf-lite", file: "dist/main.d.ts" },
  { name: "cmaf-lite-dash", file: "dist/dash.d.ts" },
];

interface ApiMember {
  kind: string;
  name?: string;
  members?: ApiMember[];
}

/**
 * Run api-extractor for an entry point, returning
 * the path to the generated api.json.
 */
function extract(entry: { name: string; file: string }): string {
  const outDir = resolve(tempDir, entry.name);
  const apiJsonPath = resolve(outDir, "cmaf-lite.api.json");

  const configObject: IConfigFile = {
    projectFolder: cmafLiteDir,
    mainEntryPointFilePath: resolve(cmafLiteDir, entry.file),
    compiler: {
      tsconfigFilePath: resolve(cmafLiteDir, "tsconfig.json"),
    },
    docModel: {
      enabled: true,
      apiJsonFilePath: apiJsonPath,
    },
    apiReport: { enabled: false },
    dtsRollup: { enabled: false },
    tsdocMetadata: { enabled: false },
  };

  const config = ExtractorConfig.prepare({
    configObject,
    configObjectFullPath: undefined,
    packageJsonFullPath: resolve(cmafLiteDir, "package.json"),
  });

  const result = Extractor.invoke(config, {
    localBuild: true,
    showVerboseMessages: false,
  });

  if (!result.succeeded) {
    throw new Error(
      `api-extractor failed for "${entry.name}" with ${result.errorCount} errors`,
    );
  }

  return apiJsonPath;
}

/**
 * Run api-documenter on the api.json, copy generated
 * markdown files into refDir.
 */
function document(apiJsonPath: string) {
  const apiJsonDir = resolve(apiJsonPath, "..");
  const mdOutDir = resolve(apiJsonDir, "docs");

  execSync(
    `pnpm exec api-documenter markdown -i ${apiJsonDir} -o ${mdOutDir}`,
    { cwd: docsDir, stdio: "inherit" },
  );

  mkdirSync(refDir, { recursive: true });
  for (const file of readdirSync(mdOutDir)) {
    writeFileSync(resolve(refDir, file), readFileSync(resolve(mdOutDir, file)));
  }
}

/**
 * Build sidebar groups from an api.json file.
 */
function buildSidebar(apiJsonPath: string) {
  const apiModel = JSON.parse(readFileSync(apiJsonPath, "utf-8"));
  const pkg = apiModel.members[0] as ApiMember;
  const pkgName = apiModel.name as string;

  const kindGroups = new Map<string, { label: string; link: string }[]>();
  for (const member of pkg.members ?? []) {
    const name = member.name ?? "";
    const link = `/reference/${pkgName}.${name}/`.toLowerCase();
    const items = kindGroups.get(member.kind) ?? [];
    items.push({ label: name, link });
    kindGroups.set(member.kind, items);
  }

  return Array.from(kindGroups, ([kind, items]) => ({
    label: kind,
    collapsed: true,
    items: items.sort((a, b) => a.label.localeCompare(b.label)),
  }));
}

/**
 * Add frontmatter and rewrite links for all markdown
 * files in refDir.
 */
function addFrontmatter() {
  for (const file of readdirSync(refDir).filter((f) => f.endsWith(".md"))) {
    const filePath = resolve(refDir, file);
    const content = readFileSync(filePath, "utf-8");

    const rawTitle = content.match(/^## (.+)$/m)?.[1] ?? file;
    const title = rawTitle.replace(
      / (class|enum|interface|variable|type alias|type|package)$/i,
      "",
    );
    const slug = `reference/${file.replace(".md", "")}`;
    const rewritten = content.replaceAll(/\.\/([\w.-]+)\.md/g, "/reference/$1");

    writeFileSync(
      filePath,
      `---\ntitle: ${title}\nslug: ${slug}\n---\n\n${rewritten}`,
    );
  }
}

// Run pipeline
const sidebar = entryPoints.map((entry) => {
  const apiJsonPath = extract(entry);
  document(apiJsonPath);
  return { label: entry.name, items: buildSidebar(apiJsonPath) };
});

addFrontmatter();

writeFileSync(
  resolve(docsDir, "sidebar.json"),
  JSON.stringify([{ label: "Reference", items: sidebar }], null, 2),
);
