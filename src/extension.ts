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
        const mainFile = editor.document;
        const imports = parseImports(mainFile.getText());
        const resolvedImports = await resolveImportPaths(
          imports,
          mainFile.fileName
        );

        const mainFileDelimiter = `<file path="${mainFile.fileName}">\n`;
        const mainFileEndDelimiter = `\n</file>\n`;
        const mainFileContent =
          mainFileDelimiter + mainFile.getText().trim() + mainFileEndDelimiter;

        const processedFiles = new Set([mainFile.fileName]);
        let extractedContent = "";
        switch (selectedOption.value) {
          case "current":
            await vscode.env.clipboard.writeText(mainFile.getText().trim());
            vscode.window.showInformationMessage(
              `Current file copied (${currentFileLines} lines)`
            );
            break;

          case "all":
            await copyAllFiles(mainFile, resolvedImports, extractor);
            break;

          case "selected":
            await copySelectedFiles(mainFile, resolvedImports, extractor);
            break;

            try {
              const importedContent = await vscode.workspace.openTextDocument(
                vscode.Uri.file(importInfo.resolvedPath)
              );

              const extractedEntities = await extractor.extractImportedEntities(
                importedContent.getText(),
                [importInfo]
              );

              if (extractedEntities.length > 0) {
                // Add delimiter for each imported file
                extractedContent += `<file path="${importInfo.resolvedPath}">\n`;
                extractedEntities.forEach(entity => {
                  extractedContent += entity.content;
                });
                extractedContent += `\n</file>\n`;
              }

              processedFiles.add(importInfo.resolvedPath);
            } catch (error) {
              outputChannel.appendLine(
                `Error processing import ${importInfo.source}: ${error}`
              );
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
  resolvedImports: any[],
  extractor: CodeExtractor
) {
  const mainFileContent = mainFile.getText().trim() + "\n\n";
  const processedFiles = new Set([mainFile.fileName]);
  let extractedContent = "";
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

      extractedEntities.forEach(entity => {
        extractedContent += entity.content;
      });

      processedFiles.add(importInfo.resolvedPath);
    } catch (error) {
      console.error(`Error processing import ${importInfo.source}:`, error);
    }
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
  resolvedImports: any[],
  extractor: CodeExtractor
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

  // Combine selected file contents
  let finalContent = "";
  const processedFiles = new Set<string>();

  for (const file of selectedFiles) {
    if (processedFiles.has(file.path)) continue;

    if (file.path === mainFile.fileName) {
      finalContent += file.content.trim() + "\n\n";
    } else {
      const importInfo = resolvedImports.find(
        imp => imp.resolvedPath === file.path
      );
      if (importInfo) {
        const extractedEntities = await extractor.extractImportedEntities(
          file.content,
          [importInfo]
        );
        extractedEntities.forEach(entity => {
          finalContent += entity.content;
        });
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
