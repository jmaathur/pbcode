import * as vscode from "vscode";
import { CodeExtractor } from "./services/CodeExtractor";
import { parseImports } from "./utils/importParser";
import { resolveImportPaths } from "./utils/pathResolution";
import { QuickPickService } from "./services/QuickPickService";
import { ImportInfo } from "./types";

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
      const currentFileLines = mainFile.getText().split("\n").length;
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
          totalRelatedLines += doc.getText().split("\n").length;
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
  resolvedImports: ImportInfo[],
  extractor: CodeExtractor,
  outputChannel: vscode.OutputChannel
) {
  const processedEntities = new Map<string, string>();

  let finalContent = addFileDelimiters(
    mainFile.fileName,
    mainFile.getText().trim()
  );
  // Initialize total lines counting the main file's content + delimiters
  let totalLines = finalContent.split("\n").length;

  for (const importInfo of resolvedImports) {
    try {
      const importedContent = await vscode.workspace.openTextDocument(
        vscode.Uri.file(importInfo.resolvedPath)
      );

      const extractedEntities = await extractor.extractImportedEntities(
        importedContent.getText(),
        importInfo
      );

      if (extractedEntities.length > 0) {
        let newContent = "";
        for (const entity of extractedEntities) {
          const entityKey = `${importInfo.resolvedPath}:${entity.name}`;

          if (!processedEntities.has(entityKey)) {
            newContent += entity.content + "\n";
            processedEntities.set(entityKey, entity.content);
          }
        }

        if (newContent.trim()) {
          const formattedContent = addFileDelimiters(
            importInfo.resolvedPath,
            newContent.trim()
          );
          finalContent += formattedContent;
          // Add the actual number of lines in the formatted content
          totalLines += formattedContent.split("\n").length;
        }
      }
    } catch (error) {
      outputChannel.appendLine(
        `Error processing import ${importInfo.source}: ${error}`
      );
    }
  }

  if (!(await QuickPickService.confirmLargeFileOperation(totalLines))) {
    return;
  }

  const finalTrimmedContent = finalContent.trim();
  // Get the exact final line count
  const finalLineCount = finalTrimmedContent.split("\n").length;

  await vscode.env.clipboard.writeText(finalTrimmedContent);
  vscode.window.showInformationMessage(
    `Code copied with ${processedEntities.size} entities from ${
      new Set(
        Array.from(processedEntities.keys()).map((key) => key.split(":")[0])
      ).size
    } files (${finalLineCount} lines)`
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

  let finalContent = "";
  const processedEntities = new Map<string, string>();

  for (const file of selectedFiles) {
    if (file.path === mainFile.fileName) {
      finalContent += addFileDelimiters(file.path, file.content.trim());
    } else {
      const importInfo = resolvedImports.find(
        (imp) => imp.resolvedPath === file.path
      );
      if (importInfo) {
        const extractedEntities = await extractor.extractImportedEntities(
          file.content,
          importInfo
        );
        if (extractedEntities.length > 0) {
          let newContent = "";
          for (const entity of extractedEntities) {
            const entityKey = `${file.path}:${entity.name}`;
            if (!processedEntities.has(entityKey)) {
              newContent += entity.content + "\n";
              processedEntities.set(entityKey, entity.content);
            }
          }

          if (newContent.trim()) {
            finalContent += addFileDelimiters(file.path, newContent.trim());
          }
        }
      }
    }
  }

  const finalTrimmedContent = finalContent.trim();
  const totalLines = finalTrimmedContent.split("\n").length;

  if (!(await QuickPickService.confirmLargeFileOperation(totalLines))) {
    return;
  }

  await vscode.env.clipboard.writeText(finalTrimmedContent);
  vscode.window.showInformationMessage(
    `Code copied with ${processedEntities.size} entities from ${
      new Set(
        Array.from(processedEntities.keys()).map((key) => key.split(":")[0])
      ).size
    } selected files (${totalLines} lines)`
  );
}

export function deactivate() {}
