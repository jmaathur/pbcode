interface PathAliasMap {
  [key: string]: string[];
}

type PathMatchResult = {
  resolved: string[];
  matched: boolean;
  originalPath: string;
  usedAlias?: string;
};

export default class PathResolver {
  private aliasMap: PathAliasMap;
  private readonly pathSeparator: string = "/";

  constructor(aliasMap: PathAliasMap) {
    this.aliasMap = this.normalizeAliasMap(aliasMap);
  }

  private normalizeAliasMap(map: PathAliasMap): PathAliasMap {
    const normalized: PathAliasMap = {};
    for (const [alias, targets] of Object.entries(map)) {
      const normalizedAlias = alias.replace(/\*+$/, "*");
      normalized[normalizedAlias] = targets.map(target =>
        target.replace(/\*+$/, "*").replace(/\/+/g, this.pathSeparator)
      );
    }
    return normalized;
  }

  private isGlobPattern(pattern: string): boolean {
    return (
      pattern.includes("*") ||
      pattern.includes("?") ||
      pattern.includes("{") ||
      pattern.includes("[")
    );
  }

  private matchGlobPattern(path: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")
      .replace(/\[([^\]]+)\]/g, "[$1]")
      .replace(/{([^}]+)}/g, "($1)");

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  private replaceAlias(path: string, alias: string, target: string): string {
    if (this.isGlobPattern(alias)) {
      // Handle glob pattern replacement
      const aliasBase = alias.split("*")[0];
      const targetBase = target.split("*")[0];
      const remainder = path.slice(aliasBase.length);
      return targetBase + remainder;
    }
    return path.replace(alias, target);
  }

  resolvePath(importPath: string): PathMatchResult {
    const normalizedPath = importPath.replace(/\/+/g, this.pathSeparator);
    const result: PathMatchResult = {
      resolved: [],
      matched: false,
      originalPath: importPath,
    };

    // Sort aliases by specificity (longer non-glob patterns first)
    const sortedAliases = Object.entries(this.aliasMap).sort(([a], [b]) => {
      const aIsGlob = this.isGlobPattern(a);
      const bIsGlob = this.isGlobPattern(b);
      if (aIsGlob !== bIsGlob) return aIsGlob ? 1 : -1;
      return b.length - a.length;
    });

    for (const [alias, targets] of sortedAliases) {
      const isGlob = this.isGlobPattern(alias);
      const matches = isGlob
        ? this.matchGlobPattern(normalizedPath, alias)
        : normalizedPath.startsWith(alias);

      if (matches) {
        result.matched = true;
        result.usedAlias = alias;
        result.resolved = targets.map(target =>
          this.replaceAlias(normalizedPath, alias, target)
        );
        break;
      }
    }

    // If no match found, return original path as the only resolution
    if (!result.matched) {
      result.resolved = [normalizedPath];
    }

    return result;
  }

  // Utility method to add new alias mappings
  addAlias(alias: string, targets: string[]): void {
    const normalizedAlias = alias.replace(/\*+$/, "*");
    this.aliasMap[normalizedAlias] = targets.map(target =>
      target.replace(/\*+$/, "*").replace(/\/+/g, this.pathSeparator)
    );
  }
}
