export interface TSConfig {
  compilerOptions?: {
    paths?: Record<string, string[]>;
    baseUrl?: string;
  };
}

export interface ImportDeclaration {
  name: string;
  alias?: string;
  isDefault?: boolean;
  isNamespace?: boolean;
}

export interface ImportInfo {
  source: string;
  imports: ImportDeclaration[];
  resolvedPath: string;
}

export interface ExtractedContent {
  name: string;
  content: string;
  location: {
    start: number;
    end: number;
  };
}
