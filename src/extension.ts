import * as vscode from "vscode";
import { CodeExtractor } from "./services/CodeExtractor";
import { parseImports } from "./utils/importParser";
import { ResolvedImportTree, resolveImportPaths } from "./utils/pathResolution";
import { QuickPickService } from "./services/QuickPickService";

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

      const mainFile = editor.document;
      const currentFileLines = mainFile.lineCount;
      const imports = parseImports(mainFile.getText());

      // Initial resolution to show basic stats
      const resolvedImports = await resolveImportPaths(
        imports,
        mainFile.fileName,
        1
      );

      // Calculate estimated lines by previewing the extracted content
      let estimatedImportedLines = 0;
      for (const importTree of resolvedImports) {
        try {
          const importedDoc = await vscode.workspace.openTextDocument(
            vscode.Uri.file(importTree.importInfo.resolvedPath)
          );
          const extractedEntities = await extractor.extractImportedEntities(
            importedDoc.getText(),
            [importTree.importInfo]
          );
          estimatedImportedLines += extractedEntities.reduce(
            (sum, entity) => sum + entity.content.split("\n").length,
            0
          );
        } catch (error) {
          console.error("Error estimating lines:", error);
        }
      }

      const selectedOption = await QuickPickService.showCopyOptions(
        currentFileLines,
        currentFileLines + estimatedImportedLines,
        resolvedImports.length
      );

      if (!selectedOption) return;

      try {
        switch (selectedOption.value) {
          case "current":
            await vscode.env.clipboard.writeText(mainFile.getText().trim());
            vscode.window.showInformationMessage(
              `Current file copied (${currentFileLines} lines)`
            );
            break;

          case "all": {
            const depth = selectedOption.depth || 1;
            const resolvedImportTree = await resolveImportPaths(
              imports,
              mainFile.fileName,
              depth
            );
            await copyAllFiles(mainFile, resolvedImportTree, extractor, depth);
            break;
          }

          case "selected": {
            const depth = await QuickPickService.selectImportDepth();
            const resolvedImportTree = await resolveImportPaths(
              imports,
              mainFile.fileName,
              depth
            );
            await copySelectedFiles(mainFile, resolvedImportTree, extractor);
            break;
          }
        }
      } catch (error) {
        outputChannel.appendLine("Error: " + error);
        outputChannel.show();
        vscode.window.showErrorMessage(`Error: ${error}`);
      }
    }
  );

  context.subscriptions.push(copyCurrentFileCommand);
}

async function copyAllFiles(
  mainFile: vscode.TextDocument,
  resolvedImports: ResolvedImportTree[],
  extractor: CodeExtractor,
  maxDepth: number
) {
  const mainFileContent = mainFile.getText().trim() + "\n\n";
  const processedFiles = new Set([mainFile.fileName]);
  let extractedContent = "";
  let totalLines = mainFile.lineCount;

  async function processImportTree(importTree: ResolvedImportTree) {
    if (processedFiles.has(importTree.importInfo.resolvedPath)) return;

    try {
      const importedContent = await vscode.workspace.openTextDocument(
        vscode.Uri.file(importTree.importInfo.resolvedPath)
      );
      const extractedEntities = await extractor.extractImportedEntities(
        importedContent.getText(),
        [importTree.importInfo]
      );

      let importedLines = 0;
      extractedEntities.forEach(entity => {
        extractedContent += entity.content;
        importedLines += entity.content.split("\n").length;
      });

      totalLines += importedLines;
      processedFiles.add(importTree.importInfo.resolvedPath);

      // Process nested imports if they exist
      if (importTree.nestedImports) {
        for (const nestedImport of importTree.nestedImports) {
          await processImportTree(nestedImport);
        }
      }
    } catch (error) {
      console.error(
        `Error processing import ${importTree.importInfo.source}:`,
        error
      );
    }
  }

  for (const importTree of resolvedImports) {
    await processImportTree(importTree);
  }

  if (!(await QuickPickService.confirmLargeFileOperation(totalLines))) {
    return;
  }

  const finalContent = mainFileContent + extractedContent.trim();
  await vscode.env.clipboard.writeText(finalContent);
  vscode.window.showInformationMessage(
    `Code copied from ${processedFiles.size} files (${totalLines} lines)`
  );
}

async function copySelectedFiles(
  mainFile: vscode.TextDocument,
  resolvedImports: ResolvedImportTree[],
  extractor: CodeExtractor
) {
  const selectedFiles = await QuickPickService.showFileSelector(
    mainFile,
    resolvedImports
  );
  if (!selectedFiles || selectedFiles.length === 0) return;

  let totalLines = mainFile.lineCount;
  let finalContent = mainFile.getText().trim() + "\n\n";
  const processedFiles = new Set<string>([mainFile.fileName]);

  for (const file of selectedFiles) {
    if (processedFiles.has(file.path)) continue;

    if (file.path !== mainFile.fileName) {
      finalContent += file.importedContent;
      totalLines += file.importedLineCount;
    }
    processedFiles.add(file.path);
  }

  if (!(await QuickPickService.confirmLargeFileOperation(totalLines))) {
    return;
  }

  await vscode.env.clipboard.writeText(finalContent.trim());
  vscode.window.showInformationMessage(
    `Code copied from ${processedFiles.size} selected files (${totalLines} lines)`
  );
}

export function deactivate() {}
