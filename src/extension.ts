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
}

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

      // Create Quick Pick for copy options
      const options: CopyOption[] = [
        {
          label: "$(file) Current File Only",
          description: "Copy only the content of the current file",
          value: "current",
        },
        {
          label: "$(files) All Related Files",
          description: "Copy current file and all its imports",
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
            vscode.window.showInformationMessage("Current file copied");
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

      extractedEntities.forEach(entity => {
        extractedContent += entity.content;
      });

      processedFiles.add(importInfo.resolvedPath);
    } catch (error) {
      console.error(`Error processing import ${importInfo.source}:`, error);
    }
  }

  const finalContent = mainFileContent + extractedContent.trim();
  await vscode.env.clipboard.writeText(finalContent);
  vscode.window.showInformationMessage(
    `Code copied from ${processedFiles.size} files`
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
      description: "Current file",
      path: mainFile.fileName,
      content: mainFile.getText(),
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
        description: `Import from ${importInfo.source}`,
        path: importInfo.resolvedPath,
        content: doc.getText(),
      });
    } catch (error) {
      console.error(`Error loading file ${relativePath}:`, error);
    }
  }

  // Show quick pick for file selection
  const selectedFiles = await vscode.window.showQuickPick(fileItems, {
    placeHolder: "Select files to copy (Space to select, Enter to confirm)",
    canPickMany: true,
    title: "Select Files to Copy",
  });

  if (!selectedFiles || selectedFiles.length === 0) return;

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
    `Code copied from ${processedFiles.size} selected files`
  );
}

export function deactivate() {}
