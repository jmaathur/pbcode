import { parse as parseTypeScript } from "@typescript-eslint/typescript-estree";
import { ImportInfo } from "../types";

export function parseImports(sourceCode: string): ImportInfo[] {
  const ast = parseTypeScript(sourceCode, { jsx: true });
  const imports: ImportInfo[] = [];

  for (const node of ast.body) {
    if (node.type === "ImportDeclaration") {
      const importInfo: ImportInfo = {
        source: node.source.value as string,
        imports: [],
        resolvedPath: "",
      };

      for (const specifier of node.specifiers) {
        switch (specifier.type) {
          case "ImportDefaultSpecifier":
            importInfo.imports.push({
              name: specifier.local.name,
              isDefault: true,
            });
            break;
          case "ImportSpecifier":
            const importedName =
              "name" in specifier.imported
                ? specifier.imported.name
                : specifier.imported.value;
            importInfo.imports.push({
              name: importedName,
              alias: specifier.local.name,
            });
            break;
          case "ImportNamespaceSpecifier":
            importInfo.imports.push({
              name: specifier.local.name,
              isNamespace: true,
            });
            break;
        }
      }

      imports.push(importInfo);
    }
  }

  return imports;
}
