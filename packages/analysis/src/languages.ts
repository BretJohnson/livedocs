const EXTENSION_LANGUAGES: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.swift': 'swift',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.prisma': 'prisma',
  '.graphql': 'graphql',
  '.proto': 'protobuf',
  '.xml': 'xml',
  '.svg': 'xml',
  '.txt': 'text',
};

export function detectLanguage(filePath: string): string | null {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return null;
  return EXTENSION_LANGUAGES[filePath.slice(dot).toLowerCase()] ?? null;
}

export function isMarkdownPath(filePath: string): boolean {
  return detectLanguage(filePath) === 'markdown';
}

/** Text-ish files whose content is worth indexing for search. */
export function isIndexableText(language: string | null, size: number): boolean {
  if (size > 1_500_000) return false;
  return language !== null;
}
