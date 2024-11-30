import * as vscode from "vscode";
import { CodeExtractor } from "./services/CodeExtractor";
import { parseImports } from "./utils/importParser";
import { resolveImportPaths } from "./utils/pathResolution";
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

      // Calculate total lines for all related files
      const mainFile = editor.document;
      const currentFileLines = mainFile.lineCount;
      const imports = parseImports(mainFile.getText());
      const resolvedImports = await resolveImportPaths(
        imports,
        mainFile.fileName
      );

      let totalRelatedLines = currentFileLines;
      for (const importInfo of resolvedImports) {
        try {
          const doc = await vscode.workspace.openTextDocument(
            vscode.Uri.file(importInfo.resolvedPath)
          );
          totalRelatedLines += doc.lineCount;
        } catch (error) {
          console.error(
            `Error loading file ${importInfo.resolvedPath}:`,
            error
          );
        }
      }

      const selectedOption = await QuickPickService.showCopyOptions(
        currentFileLines,
        totalRelatedLines,
        resolvedImports.length
      );

      if (!selectedOption) return;

      try {
        switch (selectedOption.value) {
          case "current":
            const mainContent = mainFile.getText().trim();
            await vscode.env.clipboard.writeText(
              addFileDelimiters(mainFile.fileName, mainContent)
            );
            vscode.window.showInformationMessage(
              `Current file copied (${currentFileLines} lines)`
            );
            break;

          case "all":
            await copyAllFiles(
              mainFile,
              resolvedImports,
              extractor,
              outputChannel
            );
            break;

          case "selected":
            await copySelectedFiles(
              mainFile,
              resolvedImports,
              extractor,
              outputChannel
            );
            break;
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

function addFileDelimiters(filePath: string, content: string): string {
  return `<file path="${filePath}">\n${content}\n</file>\n`;
}

async function copyAllFiles(
  mainFile: vscode.TextDocument,
  resolvedImports: any[],
  extractor: CodeExtractor,
  outputChannel: vscode.OutputChannel
) {
  const processedFiles = new Set([mainFile.fileName]);
  let finalContent = addFileDelimiters(
    mainFile.fileName,
    mainFile.getText().trim()
  );
  let totalLines = mainFile.lineCount;

  for (const importInfo of resolvedImports) {
    if (processedFiles.has(importInfo.resolvedPath)) continue;

    try {
      const importedContent = await vscode.workspace.openTextDocument(
        vscode.Uri.file(importInfo.resolvedPath)
      );
      totalLines += importedContent.lineCount;

      const extractedEntities = await extractor.extractImportedEntities(
        importedContent.getText(),
        [importInfo]
      );

      if (extractedEntities.length > 0) {
        const content = extractedEntities
          .map(entity => entity.content)
          .join("\n");
        finalContent += addFileDelimiters(importInfo.resolvedPath, content);
      }

      processedFiles.add(importInfo.resolvedPath);
    } catch (error) {
      outputChannel.appendLine(
        `Error processing import ${importInfo.source}: ${error}`
      );
    }
  }

  if (!(await QuickPickService.confirmLargeFileOperation(totalLines))) {
    return;
  }

  await vscode.env.clipboard.writeText(finalContent.trim());
  vscode.window.showInformationMessage(
    `Code copied from ${processedFiles.size} files (${totalLines} lines)`
  );
}

async function copySelectedFiles(
  mainFile: vscode.TextDocument,
  resolvedImports: any[],
  extractor: CodeExtractor,
  outputChannel: vscode.OutputChannel
) {
  const selectedFiles = await QuickPickService.showFileSelector(
    mainFile,
    resolvedImports
  );
  if (!selectedFiles || selectedFiles.length === 0) return;

  const totalLines = selectedFiles.reduce(
    (total, file) => total + file.lineCount,
    0
  );
  if (!(await QuickPickService.confirmLargeFileOperation(totalLines))) {
    return;
  }

  let finalContent = "";
  const processedFiles = new Set<string>();

  for (const file of selectedFiles) {
    if (processedFiles.has(file.path)) continue;

    if (file.path === mainFile.fileName) {
      finalContent += addFileDelimiters(file.path, file.content.trim());
    } else {
      const importInfo = resolvedImports.find(
        imp => imp.resolvedPath === file.path
      );
      if (importInfo) {
        const extractedEntities = await extractor.extractImportedEntities(
          file.content,
          [importInfo]
        );
        if (extractedEntities.length > 0) {
          const content = extractedEntities
            .map(entity => entity.content)
            .join("\n");
          finalContent += addFileDelimiters(file.path, content);
        }
      }
    }
    processedFiles.add(file.path);
  }

  await vscode.env.clipboard.writeText(finalContent.trim());
  vscode.window.showInformationMessage(
    `Code copied from ${processedFiles.size} selected files (${totalLines} lines)`
  );
}

export function deactivate() {}
