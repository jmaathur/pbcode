// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from "path";
import * as fs from "fs/promises";
import { parse as parseTypeScript } from "@typescript-eslint/typescript-estree";
import { TSESTree } from "@typescript-eslint/types";

interface TSConfig {
	compilerOptions?: {
	  paths?: Record<string, string[]>;
	  baseUrl?: string;
	};
  }
  
  interface ImportInfo {
	source: string;
	imports: {
	  name: string;
	  alias?: string;
	  isDefault?: boolean;
	  isNamespace?: boolean;
	}[];
	resolvedPath: string;
  }
  
  interface ExtractedContent {
	content: string;
	location: {
	  start: number;
	  end: number;
	};
  }
  
  interface ImportDeclaration {
	name: string;
	alias?: string;
	isDefault?: boolean;
	isNamespace?: boolean;
  }
  
  interface ImportInfo {
	source: string;
	imports: ImportDeclaration[];
	resolvedPath: string;
  }
  
  interface ExtractedContent {
	content: string;
	location: {
	  start: number;
	  end: number;
	};
  }
  
  export class CodeExtractor {
	private seenDeclarations = new Set<string>();
  
	async extractImportedEntities(
	  sourceCode: string,
	  imports: ImportInfo[]
	): Promise<ExtractedContent[]> {
	  // Reset seen declarations for each extraction
	  this.seenDeclarations.clear();
  
	  try {
		return this.findDeclarations(sourceCode, imports);
	  } catch (error) {
		console.error("Failed to extract entities:", error);
		return [];
	  }
	}
  
	private findDeclarations(
	  sourceCode: string,
	  imports: ImportInfo[]
	): ExtractedContent[] {
	  const extracted: ExtractedContent[] = [];
	  const lines = sourceCode.split("\n");
  
	  let currentDeclaration: string[] = [];
	  let isCollecting = false;
	  let bracketCount = 0;
	  let currentName: string | null = null;
  
	  const storeCurrentDeclaration = () => {
		if (
		  currentName &&
		  !this.seenDeclarations.has(currentName) &&
		  this.isImportedInAny(currentName, imports)
		) {
		  this.seenDeclarations.add(currentName);
		  extracted.push({
			content: this.formatDeclaration(currentDeclaration.join("\n")),
			location: { start: 0, end: 0 },
		  });
		}
		isCollecting = false;
		currentDeclaration = [];
		currentName = null;
		bracketCount = 0;
	  };
  
	  for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
  
		if (!isCollecting) {
		  // Look for declaration starts
		  const declarationMatch = line.match(
			/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const)\s+([A-Za-z0-9_]+)/
		  );
  
		  if (declarationMatch) {
			currentName = declarationMatch[1];
			isCollecting = true;
			currentDeclaration = [lines[i]];
			bracketCount =
			  (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
			continue;
		  }
		}
  
		if (isCollecting) {
		  currentDeclaration.push(lines[i]);
  
		  // Count brackets to properly handle nested structures
		  bracketCount += (line.match(/{/g) || []).length;
		  bracketCount -= (line.match(/}/g) || []).length;
  
		  // Check if we've reached the end of the declaration
		  if (bracketCount === 0 && line.match(/[};]/)) {
			storeCurrentDeclaration();
		  }
		}
	  }
  
	  // Handle any remaining declaration
	  if (isCollecting) {
		storeCurrentDeclaration();
	  }
  
	  return extracted;
	}
  
	private formatDeclaration(content: string): string {
	  // Remove extra blank lines
	  content = content.replace(/\n\s*\n\s*\n/g, "\n\n");
  
	  // Ensure consistent export format
	  content = content.replace(/^export\s+default\s+/, "");
  
	  // Add newlines before and after
	  content = `\n${content.trim()}\n`;
  
	  return content;
	}
  
	private isImportedInAny(name: string, imports: ImportInfo[]): boolean {
	  return imports.some((importInfo) =>
		importInfo.imports.some(
		  (imp) =>
			imp.name === name ||
			imp.alias === name ||
			(imp.isDefault && name === "default")
		)
	  );
	}
  }
  
  function parseImports(sourceCode: string): ImportInfo[] {
	const ast = parseTypeScript(sourceCode, { jsx: true });
	const imports: ImportInfo[] = [];
  
	for (const node of ast.body) {
	  if (node.type === "ImportDeclaration") {
		const importInfo: ImportInfo = {
		  source: node.source.value as string,
		  imports: [],
		  resolvedPath: "", // Will be filled later
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
  
	// For Next.js projects, we need to try multiple base directories
	const possibleBaseDirs = [
	  "", // Root directory
	  "src", // Source directory (common in Next.js projects)
	  "app", // Next.js app directory
	];
  
	for (const baseDir of possibleBaseDirs) {
	  // Handle both @/ and @lib/ patterns
	  if (importPath.startsWith("@/")) {
		const relativePath = importPath.slice(2); // Remove '@/'
		const possiblePaths = [
		  path.join(workspaceRoot, baseDir, relativePath),
		  path.join(workspaceRoot, baseDir, relativePath, "index"),
		  // For Next.js page components
		  path.join(workspaceRoot, baseDir, relativePath, "page"),
		];
  
		console.log("Trying @/ paths:", possiblePaths);
  
		for (const basePath of possiblePaths) {
		  const resolved = await tryExtensions(basePath);
		  if (resolved) return resolved;
		}
	  } else if (importPath.startsWith("@lib/")) {
		const relativePath = importPath.slice(5); // Remove '@lib/'
		const possiblePaths = [
		  path.join(workspaceRoot, baseDir, "lib", relativePath),
		  path.join(workspaceRoot, "lib", relativePath),
		  path.join(workspaceRoot, baseDir, "lib", relativePath, "index"),
		];
  
		console.log("Trying @lib/ paths:", possiblePaths);
  
		for (const basePath of possiblePaths) {
		  const resolved = await tryExtensions(basePath);
		  if (resolved) return resolved;
		}
	  }
	}
  
	console.log("No matching file found for:", importPath);
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
  
  async function resolveImportPaths(
	imports: ImportInfo[],
	currentFilePath: string
  ): Promise<ImportInfo[]> {
	console.log("\nResolving import paths for file:", currentFilePath);
  
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
	if (!workspaceRoot) {
	  throw new Error("No workspace root found");
	}
  
	const tsconfig = await loadTSConfig(workspaceRoot);
	console.log("Loaded TSConfig:", tsconfig);
  
	const resolvedImports: ImportInfo[] = [];
  
	for (const importInfo of imports) {
	  console.log("\nProcessing import:", importInfo.source);
  
	  try {
		let resolvedPath: string | null = null;
  
		// Handle aliased imports (both @/ and @lib/ patterns)
		if (importInfo.source.startsWith("@")) {
		  resolvedPath = await resolveAliasPath(
			importInfo.source,
			workspaceRoot,
			tsconfig
		  );
		} else if (importInfo.source.startsWith(".")) {
		  // Handle relative imports
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
  
	console.log("\nFinal resolved imports:", resolvedImports);
	return resolvedImports;
  }
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	const extractor = new CodeExtractor();
	const outputChannel = vscode.window.createOutputChannel("PBCode");
  
	const copyCurrentFileCommand = vscode.commands.registerCommand(
	  "pbcode.copyCurrentFile",
	  async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
		  vscode.window.showErrorMessage("No file is currently open");
		  return;
		}
  
		try {
		  const mainFile = editor.document;
		  const imports = parseImports(mainFile.getText());
		  const resolvedImports = await resolveImportPaths(
			imports,
			mainFile.fileName
		  );
  
		  // Start with the original file
		  const mainFileContent = mainFile.getText().trim() + "\n\n";
		  const processedFiles = new Set([mainFile.fileName]);
		  let extractedContent = "";
  
		  // Process each imported file
		  for (const importInfo of resolvedImports) {
			if (processedFiles.has(importInfo.resolvedPath)) continue;
  
			try {
			  const importedContent = await vscode.workspace.openTextDocument(
				vscode.Uri.file(importInfo.resolvedPath)
			  );
  
			  const extractedEntities = await extractor.extractImportedEntities(
				importedContent.getText(),
				[importInfo]
			  );
  
			  extractedEntities.forEach((entity) => {
				extractedContent += entity.content;
			  });
  
			  processedFiles.add(importInfo.resolvedPath);
			} catch (error) {
			  outputChannel.appendLine(
				`Error processing import ${importInfo.source}: ${error}`
			  );
			}
		  }
  
		  // Combine main file and extracted content
		  const finalContent = mainFileContent + extractedContent.trim();
  
		  await vscode.env.clipboard.writeText(finalContent);
		  vscode.window.showInformationMessage(
			`Code copied from ${processedFiles.size} files`
		  );
		} catch (error) {
		  outputChannel.appendLine("Error: " + error);
		  outputChannel.show();
		  vscode.window.showErrorMessage(`Error: ${error}`);
		}
	  }
	);
  
	context.subscriptions.push(copyCurrentFileCommand);
  }
  


// This method is called when your extension is deactivated
export function deactivate() {}
