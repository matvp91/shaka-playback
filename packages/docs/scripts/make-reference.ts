import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const docsDir = resolve(import.meta.dirname, "..");
const generatedDir = resolve(docsDir, "../cmaf-lite/__generated_docs__");
const mdSourceDir = resolve(generatedDir, "markdown");
const apiJsonPath = resolve(generatedDir, "cmaf-lite.api.json");
const refDir = resolve(docsDir, "src/content/docs/reference");

interface ApiMember {
  kind: string;
  name?: string;
  members?: ApiMember[];
}

/**
 * Copy generated markdown files into the reference
 * directory.
 */
function copyMarkdown() {
  mkdirSync(refDir, { recursive: true });
  for (const file of readdirSync(mdSourceDir)) {
    writeFileSync(
      resolve(refDir, file),
      readFileSync(resolve(mdSourceDir, file)),
    );
  }
}

/**
 * Build sidebar groups from the api.json file.
 */
function buildSidebar() {
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
copyMarkdown();

const sidebar = [
  { label: "cmaf-lite", items: buildSidebar() },
];

addFrontmatter();

writeFileSync(
  resolve(docsDir, "sidebar-reference.json"),
  JSON.stringify([{ label: "Reference", items: sidebar }], null, 2),
);
