import * as vscode from "vscode";

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
}

export interface CopyOption {
  label: string;
  description: string;
  detail?: string;
  value: "current" | "all" | "selected";
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
      },
      {
        label: "$(files) All Related Imports",
        description: `${totalRelatedLines} lines total from ${
          importCount + 1
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

    return vscode.window.showQuickPick(options, {
      placeHolder: "Choose what to copy",
      title: "PBCode Copy Options",
    });
  }

  static async showFileSelector(
    mainFile: vscode.TextDocument,
    resolvedImports: any[]
  ): Promise<FileItem[] | undefined> {
    const fileItems = await this.prepareFileItems(mainFile, resolvedImports);
    const quickPick = vscode.window.createQuickPick();
    quickPick.items = fileItems;
    quickPick.canSelectMany = true;
    quickPick.title = "Select Files to Copy";
    quickPick.placeholder = "Space to select, Enter to confirm";

    let selectedFiles: FileItem[] = [];

    quickPick.onDidChangeSelection((items) => {
      selectedFiles = items as FileItem[];
      const totalLines = this.calculateTotalLines(selectedFiles);
      const indicator = getSizeIndicator(totalLines);
      quickPick.title = `Total: ${totalLines} lines - ${indicator.message}`;
    });

    const result = await new Promise<FileItem[] | undefined>((resolve) => {
      quickPick.onDidAccept(() => {
        resolve(selectedFiles);
        quickPick.hide();
      });
      quickPick.onDidHide(() => resolve(undefined));
      quickPick.show();
    });

    return result;
  }

  private static calculateTotalLines(files: FileItem[]): number {
    return files.reduce((total, file) => total + file.lineCount, 0);
  }

  private static async prepareFileItems(
    mainFile: vscode.TextDocument,
    resolvedImports: any[]
  ): Promise<FileItem[]> {
    let totalLines = mainFile.getText().split("\n").length;
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

    for (const importInfo of resolvedImports) {
      const relativePath = vscode.workspace.asRelativePath(
        importInfo.resolvedPath
      );
      try {
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(importInfo.resolvedPath)
        );
        const docLineCount = doc.getText().split("\n").length;
        totalLines += docLineCount;
        fileItems.push({
          label: "$(file) " + relativePath,
          description: `${docLineCount} lines`,
          detail: getSizeIndicator(docLineCount).message,
          path: importInfo.resolvedPath,
          content: doc.getText(),
          lineCount: docLineCount,
        });
      } catch (error) {
        console.error(`Error loading file ${relativePath}:`, error);
      }
    }

    // Update the total line count for all files
    const firstItem = fileItems[0];
    if (firstItem) {
      firstItem.detail = `Total: ${totalLines} lines - ${
        getSizeIndicator(totalLines).message
      }`;
    }

    return fileItems;
  }
}
