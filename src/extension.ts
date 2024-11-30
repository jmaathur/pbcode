import * as vscode from "vscode";
import { CodeExtractor } from "./services/CodeExtractor";
import { parseImports } from "./utils/importParser";
import { resolveImportPaths } from "./utils/pathResolution";

interface CopyOption {
  label: string;
  description: string;
  detail?: string;
  value: "current" | "all" | "selected";
}

interface FileItem extends vscode.QuickPickItem {
  path: string;
  content: string;
  lineCount: number;
}

// Constants for size limits
const SIZE_LIMITS = {
  OPTIMAL: 1000,
  WARNING: 2000,
  CRITICAL: 3000,
};

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

      const currentSizeIndicator = getSizeIndicator(currentFileLines);
      const allFilesSizeIndicator = getSizeIndicator(totalRelatedLines);

      // Create Quick Pick for copy options
      const options: CopyOption[] = [
        {
          label: "$(file) Current File Only",
          description: `${currentFileLines} lines`,
          detail: `${currentSizeIndicator.icon} ${currentSizeIndicator.message}`,
          value: "current",
        },
        {
          label: "$(files) All Related Imports",
          description: `${totalRelatedLines} lines total from ${
            resolvedImports.length + 1
          } files`,
          detail: `${allFilesSizeIndicator.icon} ${allFilesSizeIndicator.message}`,
          value: "all",
        },
        {
          label: "$(list-selection) Select Files",
          description: "Choose which files to copy",
          value: "selected",
        },
      ];

      const selectedOption = await vscode.window.showQuickPick(options, {
        placeHolder: "Choose what to copy",
        title: "PBCode Copy Options",
      });

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

function getSizeIndicator(lineCount: number): {
  message: string;
  icon: string;
} {
  if (lineCount <= SIZE_LIMITS.OPTIMAL) {
    return {
      message: "✓ Optimal size for AI assistance",
      icon: "$(check)",
    };
  } else if (lineCount <= SIZE_LIMITS.WARNING) {
    return {
      message: "⚠️ Large file - Consider selecting specific sections",
      icon: "$(warning)",
    };
  } else {
    return {
      message: "⛔ Very large file - AI assistance may be limited",
      icon: "$(error)",
    };
  }
}

function calculateTotalLines(files: FileItem[]): number {
  return files.reduce((total, file) => total + file.lineCount, 0);
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

  const sizeIndicator = getSizeIndicator(totalLines);
  if (totalLines > SIZE_LIMITS.WARNING) {
    const proceed = await vscode.window.showWarningMessage(
      `The combined code is ${totalLines} lines. ${sizeIndicator.message}`,
      "Copy Anyway",
      "Cancel"
    );
    if (proceed !== "Copy Anyway") return;
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
  // Prepare file items for selection
  const fileItems: FileItem[] = [
    {
      label: "$(file) " + vscode.workspace.asRelativePath(mainFile.fileName),
      description: `${mainFile.lineCount} lines`,
      detail: getSizeIndicator(mainFile.lineCount).message,
      path: mainFile.fileName,
      content: mainFile.getText(),
      lineCount: mainFile.lineCount,
      picked: true,
    },
  ];

  // Add imported files
  for (const importInfo of resolvedImports) {
    const relativePath = vscode.workspace.asRelativePath(
      importInfo.resolvedPath
    );
    try {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(importInfo.resolvedPath)
      );
      fileItems.push({
        label: "$(file) " + relativePath,
        description: `${doc.lineCount} lines`,
        detail: getSizeIndicator(doc.lineCount).message,
        path: importInfo.resolvedPath,
        content: doc.getText(),
        lineCount: doc.lineCount,
      });
    } catch (error) {
      console.error(`Error loading file ${relativePath}:`, error);
    }
  }

  const quickPick = vscode.window.createQuickPick();
  quickPick.items = fileItems;
  quickPick.canSelectMany = true;
  quickPick.title = "Select Files to Copy";
  quickPick.placeholder = "Space to select, Enter to confirm";

  let selectedFiles: FileItem[] = [];

  // Update the description as files are selected
  quickPick.onDidChangeSelection(items => {
    selectedFiles = items as FileItem[];
    const totalLines = calculateTotalLines(selectedFiles);
    const indicator = getSizeIndicator(totalLines);
    quickPick.title = `Total: ${totalLines} lines - ${indicator.message}`;
  });

  const result = await new Promise<FileItem[] | undefined>(resolve => {
    quickPick.onDidAccept(() => {
      resolve(selectedFiles);
      quickPick.hide();
    });
    quickPick.onDidHide(() => resolve(undefined));
    quickPick.show();
  });

  if (!result || result.length === 0) return;

  const totalLines = calculateTotalLines(result);
  if (totalLines > SIZE_LIMITS.WARNING) {
    const proceed = await vscode.window.showWarningMessage(
      `The combined code is ${totalLines} lines. This might be too large for optimal AI assistance.`,
      "Copy Anyway",
      "Cancel"
    );
    if (proceed !== "Copy Anyway") return;
  }

  // Combine selected file contents
  let finalContent = "";
  const processedFiles = new Set<string>();

  for (const file of result) {
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
