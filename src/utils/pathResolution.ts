import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import { TSConfig, ImportInfo } from "../types";
import PathResolver from "../services/PathResolver";
import JSON5 from "json5";

async function loadTSConfig(workspaceRoot: string): Promise<TSConfig> {
  try {
    const tsconfigPath = path.join(workspaceRoot, "tsconfig.json");
    const tsconfigContent = await fs.readFile(tsconfigPath, "utf-8");
    return JSON5.parse(tsconfigContent);
  } catch (error) {
    console.error("Failed to load tsconfig.json:", error);
    return {};
  }
}

function matchesAtStart(input: string, pattern: string): boolean {
  const regex = new RegExp("^" + pattern);
  return regex.test(input);
}

async function resolveAliasPath(
  importPath: string,
  workspaceRoot: string,
  tsconfig: TSConfig
): Promise<string | null> {
  const paths = tsconfig.compilerOptions?.paths || {};

  const resolver = new PathResolver(paths);

  const possibleBaseDirs = ["", "src", "app"];

  for (const baseDir of possibleBaseDirs) {
    const { resolved } = resolver.resolvePath(importPath);
    const possiblePaths = [
      path.join(workspaceRoot, baseDir, resolved[0]),
      path.join(workspaceRoot, baseDir, resolved[0], "page"),
      path.join(workspaceRoot, baseDir, resolved[0], "index"),
    ];

    for (const basePath of possiblePaths) {
      const tryExtensionResult = await tryExtensions(basePath);
      if (tryExtensionResult) {
        return tryExtensionResult;
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

      if (importInfo.source.startsWith(".")) {
        const absolutePath = path.resolve(
          path.dirname(currentFilePath),
          importInfo.source
        );
        resolvedPath = await tryExtensions(absolutePath);
      } else {
        resolvedPath = await resolveAliasPath(
          importInfo.source,
          workspaceRoot,
          tsconfig
        );
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
