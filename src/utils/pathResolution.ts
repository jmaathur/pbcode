import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import { TSConfig, ImportInfo } from "../types";
import PathResolver from "../services/PathResolver";
import JSON5 from "json5";
import { parseImports } from "./importParser";

export interface ResolvedImportTree {
  importInfo: ImportInfo;
  nestedImports?: ResolvedImportTree[];
}

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
  currentFilePath: string,
  maxDepth: number = 1,
  processedPaths: Set<string> = new Set()
): Promise<ResolvedImportTree[]> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
  if (!workspaceRoot) {
    throw new Error("No workspace root found");
  }

  const tsconfig = await loadTSConfig(workspaceRoot);
  const resolvedTrees: ResolvedImportTree[] = [];

  // Add current file to processed paths to prevent circular imports
  processedPaths.add(currentFilePath);

  for (const importInfo of imports) {
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

      if (resolvedPath && !processedPaths.has(resolvedPath)) {
        importInfo.resolvedPath = resolvedPath;
        const importTree: ResolvedImportTree = { importInfo };

        // If we haven't reached max depth, process nested imports
        if (maxDepth > 1) {
          const doc = await vscode.workspace.openTextDocument(
            vscode.Uri.file(resolvedPath)
          );
          const nestedImports = parseImports(doc.getText());
          importTree.nestedImports = await resolveImportPaths(
            nestedImports,
            resolvedPath,
            maxDepth - 1,
            processedPaths
          );
        }

        resolvedTrees.push(importTree);
        processedPaths.add(resolvedPath);
      }
    } catch (error) {
      console.error(`Failed to resolve import: ${importInfo.source}`, error);
    }
  }

  return resolvedTrees;
}
