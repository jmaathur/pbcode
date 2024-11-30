import * as vscode from "vscode";
import { ResolvedImportTree } from "../utils/pathResolution";
import { CodeExtractor } from "../services/CodeExtractor";

const SIZE_LIMITS = {
  OPTIMAL: 1000,
  WARNING: 2000,
  CRITICAL: 3000,
};

function getSizeIndicator(lineCount: number): {
  message: string;
  icon: string;
} {
  if (lineCount <= SIZE_LIMITS.OPTIMAL) {
    return {
      message: "Optimal size for AI assistance",
      icon: "$(pass-filled)",
    };
  } else if (lineCount <= SIZE_LIMITS.WARNING) {
    return {
      message: "Large file - Consider selecting specific sections",
      icon: "$(warning)",
    };
  } else {
    return {
      message: "Very large file - AI assistance may be limited",
      icon: "$(error)",
    };
  }
}

export interface FileItem extends vscode.QuickPickItem {
  path: string;
  content: string;
  lineCount: number;
  importedContent: string;
  importedLineCount: number;
}

export interface CopyOption {
  label: string;
  description: string;
  detail?: string;
  value: "current" | "all" | "selected";
  depth?: number;
}

export class QuickPickService {
  static async showCopyOptions(
    currentFileLines: number,
    totalRelatedLines: number,
    importCount: number
  ): Promise<CopyOption | undefined> {
    const currentSizeIndicator = getSizeIndicator(currentFileLines);
    const allFilesSizeIndicator = getSizeIndicator(totalRelatedLines);

    const options: CopyOption[] = [
      {
        label: "$(file) Current File Only",
        description: `${currentFileLines} lines`,
        detail: `${currentSizeIndicator.icon} ${currentSizeIndicator.message}`,
        value: "current",
        depth: 0,
      },
      {
        label: "$(files) Direct Imports Only",
        description: `${totalRelatedLines} lines total from ${
          importCount + 1
        } files`,
        detail: `${allFilesSizeIndicator.icon} ${allFilesSizeIndicator.message}`,
        value: "all",
        depth: 1,
      },
      {
        label: "$(files) All Nested Imports (2 levels)",
        description: "Include imports of imports",
        value: "all",
        depth: 2,
      },
      {
        label: "$(files) All Nested Imports (3 levels)",
        description: "Include deeply nested imports",
        value: "all",
        depth: 3,
      },
      {
        label: "$(list-selection) Select Files and Depth",
        description: "Choose which files to copy",
        value: "selected",
      },
    ];

    return vscode.window.showQuickPick(options, {
      placeHolder: "Choose what to copy",
      title: "PBCode Copy Options",
    });
  }

  static async selectImportDepth(): Promise<number> {
    const depthOptions = [
      { label: "Direct imports only", value: 1 },
      { label: "Include imports of imports", value: 2 },
      { label: "Include deeply nested imports", value: 3 },
    ];

    const selected = await vscode.window.showQuickPick(depthOptions, {
      placeHolder: "Select how deep to search for imports",
      title: "Import Depth Selection",
    });

    return selected ? selected.value : 1;
  }

  static async showFileSelector(
    mainFile: vscode.TextDocument,
    resolvedImports: ResolvedImportTree[]
  ): Promise<FileItem[] | undefined> {
    const fileItems = await this.prepareFileItems(mainFile, resolvedImports);
    const quickPick = vscode.window.createQuickPick();
    quickPick.items = fileItems;
    quickPick.canSelectMany = true;
    quickPick.title =
      "Select Additional Files to Copy (Main File Always Included)";
    quickPick.placeholder = "Space to select, Enter to confirm";

    let selectedFiles: FileItem[] = [];

    quickPick.onDidChangeSelection(items => {
      selectedFiles = items as FileItem[];
      const totalLines =
        mainFile.lineCount + this.calculateTotalLines(selectedFiles);
      const indicator = getSizeIndicator(totalLines);
      quickPick.title = `Total: ${totalLines} lines (including main file) - ${indicator.message}`;
    });

    const result = await new Promise<FileItem[] | undefined>(resolve => {
      quickPick.onDidAccept(() => {
        // Include the main file with the selected files
        resolve([
          {
            label: `$(file) ${vscode.workspace.asRelativePath(
              mainFile.fileName
            )}`,
            description: `${mainFile.lineCount} lines`,
            path: mainFile.fileName,
            content: mainFile.getText(),
            lineCount: mainFile.lineCount,
            importedContent: mainFile.getText(),
            importedLineCount: mainFile.lineCount,
          },
          ...selectedFiles,
        ]);
        quickPick.hide();
      });
      quickPick.onDidHide(() => resolve(undefined));
      quickPick.show();
    });

    return result;
  }

  static async confirmLargeFileOperation(totalLines: number): Promise<boolean> {
    if (totalLines <= SIZE_LIMITS.WARNING) {
      return true;
    }

    const proceed = await vscode.window.showWarningMessage(
      `The combined code is ${totalLines} lines. This might be too large for optimal AI assistance.`,
      "Copy Anyway",
      "Cancel"
    );

    return proceed === "Copy Anyway";
  }

  private static calculateTotalLines(files: FileItem[]): number {
    return files.reduce((total, file) => total + file.importedLineCount, 0);
  }

  private static async prepareFileItems(
    mainFile: vscode.TextDocument,
    resolvedImports: ResolvedImportTree[]
  ): Promise<FileItem[]> {
    const fileItems: FileItem[] = [];
    const processedPaths = new Set<string>([mainFile.fileName]);
    const extractor = new CodeExtractor();

    async function processImportTree(importTree: ResolvedImportTree) {
      if (processedPaths.has(importTree.importInfo.resolvedPath)) return;

      const relativePath = vscode.workspace.asRelativePath(
        importTree.importInfo.resolvedPath
      );

      try {
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(importTree.importInfo.resolvedPath)
        );

        // Extract only the imported entities
        const extractedEntities = await extractor.extractImportedEntities(
          doc.getText(),
          [importTree.importInfo]
        );

        let importedContent = "";
        let importedLineCount = 0;
        extractedEntities.forEach(entity => {
          importedContent += entity.content;
          importedLineCount += entity.content.split("\n").length;
        });

        fileItems.push({
          label: `$(file) ${relativePath}`,
          detail: `${importedLineCount} lines of imported content (from ${doc.lineCount} total lines)`,
          path: importTree.importInfo.resolvedPath,
          content: doc.getText(),
          lineCount: doc.lineCount,
          importedContent: importedContent,
          importedLineCount: importedLineCount,
        });

        processedPaths.add(importTree.importInfo.resolvedPath);

        if (importTree.nestedImports) {
          for (const nestedImport of importTree.nestedImports) {
            await processImportTree(nestedImport);
          }
        }
      } catch (error) {
        console.error(`Error loading file ${relativePath}:`, error);
      }
    }

    for (const importTree of resolvedImports) {
      await processImportTree(importTree);
    }

    // Sort files by imported line count in descending order
    return fileItems.sort((a, b) => b.importedLineCount - a.importedLineCount);
  }
}
