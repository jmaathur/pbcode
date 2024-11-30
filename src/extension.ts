import * as vscode from "vscode";
import { CodeExtractor } from "./services/CodeExtractor";
import { parseImports } from "./utils/importParser";
import { resolveImportPaths } from "./utils/pathResolution";

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

export function deactivate() {}
