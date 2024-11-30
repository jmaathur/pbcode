import { ImportInfo, ExtractedContent } from "../types";

export class CodeExtractor {
  private seenDeclarations = new Set<string>();

  async extractImportedEntities(
    sourceCode: string,
    imports: ImportInfo[]
  ): Promise<ExtractedContent[]> {
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
        bracketCount += (line.match(/{/g) || []).length;
        bracketCount -= (line.match(/}/g) || []).length;

        if (bracketCount === 0 && line.match(/[};]/)) {
          storeCurrentDeclaration();
        }
      }
    }

    if (isCollecting) {
      storeCurrentDeclaration();
    }

    return extracted;
  }

  private formatDeclaration(content: string): string {
    content = content.replace(/\n\s*\n\s*\n/g, "\n\n");
    content = content.replace(/^export\s+default\s+/, "");
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
