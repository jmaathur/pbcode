import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import { TSConfig, ImportInfo } from "../types";

async function loadTSConfig(workspaceRoot: string): Promise<TSConfig> {
  try {
    const tsconfigPath = path.join(workspaceRoot, "tsconfig.json");
    const tsconfigContent = await fs.readFile(tsconfigPath, "utf-8");
    return JSON.parse(tsconfigContent);
  } catch (error) {
    console.error("Failed to load tsconfig.json:", error);
    return {};
  }
}

async function resolveAliasPath(
  importPath: string,
  workspaceRoot: string,
  tsconfig: TSConfig
): Promise<string | null> {
  console.log("\nResolving alias path:", {
    importPath,
    workspaceRoot,
  });

  const paths = tsconfig.compilerOptions?.paths || {};
  console.log("TSConfig paths:", paths);

  const possibleBaseDirs = ["", "src", "app"];

  for (const baseDir of possibleBaseDirs) {
    if (importPath.startsWith("@/")) {
      const relativePath = importPath.slice(2);
      const possiblePaths = [
        path.join(workspaceRoot, baseDir, relativePath),
        path.join(workspaceRoot, baseDir, relativePath, "index"),
        path.join(workspaceRoot, baseDir, relativePath, "page"),
      ];

      for (const basePath of possiblePaths) {
        const resolved = await tryExtensions(basePath);
        if (resolved) return resolved;
      }
    } else if (importPath.startsWith("@lib/")) {
      const relativePath = importPath.slice(5);
      const possiblePaths = [
        path.join(workspaceRoot, baseDir, "lib", relativePath),
        path.join(workspaceRoot, "lib", relativePath),
        path.join(workspaceRoot, baseDir, "lib", relativePath, "index"),
      ];

      for (const basePath of possiblePaths) {
        const resolved = await tryExtensions(basePath);
        if (resolved) return resolved;
      }
    }
  }

  return null;
}

async function tryExtensions(basePath: string): Promise<string | null> {
  const extensions = [".ts", ".tsx", ".js", ".jsx"];
  for (const ext of extensions) {
    const fullPath = basePath + ext;
    try {
      await fs.access(fullPath);
      console.log("Found matching file:", fullPath);
      return fullPath;
    } catch {
      continue;
    }
  }
  return null;
}

export async function resolveImportPaths(
  imports: ImportInfo[],
  currentFilePath: string
): Promise<ImportInfo[]> {
  console.log("\nResolving import paths for file:", currentFilePath);

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
  if (!workspaceRoot) {
    throw new Error("No workspace root found");
  }

  const tsconfig = await loadTSConfig(workspaceRoot);
  const resolvedImports: ImportInfo[] = [];

  for (const importInfo of imports) {
    console.log("\nProcessing import:", importInfo.source);

    try {
      let resolvedPath: string | null = null;

      if (importInfo.source.startsWith("@")) {
        resolvedPath = await resolveAliasPath(
          importInfo.source,
          workspaceRoot,
          tsconfig
        );
      } else if (importInfo.source.startsWith(".")) {
        const absolutePath = path.resolve(
          path.dirname(currentFilePath),
          importInfo.source
        );
        resolvedPath = await tryExtensions(absolutePath);
      }

      if (resolvedPath) {
        console.log("Successfully resolved path:", resolvedPath);
        importInfo.resolvedPath = resolvedPath;
        resolvedImports.push(importInfo);
      } else {
        console.log("Could not resolve path for:", importInfo.source);
      }
    } catch (error) {
      console.error(`Failed to resolve import: ${importInfo.source}`, error);
    }
  }

  return resolvedImports;
}
