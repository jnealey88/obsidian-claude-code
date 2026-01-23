import { TFile, CachedMetadata, FrontMatterCache } from 'obsidian';
import type ClaudeCodePlugin from '../main';
import { ContextReference } from '../types';

export interface VaultSearchResult {
  file: TFile;
  path: string;
  title: string;
  excerpt?: string;
  score: number;
  relevanceReason?: string;
}

export interface ContextGatheringResult {
  files: ContextReference[];
  totalLength: number;
  truncated: boolean;
}

// Parsed frontmatter for context-aware searching
interface ParsedFrontmatter {
  title?: string;
  tags?: string[];
  keywords?: string[];
  related?: string[];
  summary?: string;
  type?: string;
  status?: string;
}

export class ContextProviderService {
  private plugin: ClaudeCodePlugin;

  constructor(plugin: ClaudeCodePlugin) {
    this.plugin = plugin;
  }

  async getCurrentNoteContext(): Promise<ContextReference | null> {
    // First try to get web viewer context
    const webContext = await this.getWebViewerContext();
    if (webContext) {
      return webContext;
    }

    // Fall back to markdown file
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== 'md') {
      return null;
    }

    const content = await this.plugin.app.vault.cachedRead(activeFile);
    return {
      type: 'file',
      path: activeFile.path,
      title: activeFile.basename,
      content,
    };
  }

  async getWebViewerContext(): Promise<ContextReference | null> {
    try {
      // Search for any webviewer in the workspace
      const leaves = this.plugin.app.workspace.getLeavesOfType('webviewer');
      if (leaves.length === 0) return null;

      const view = leaves[0].view;
      if (!view || !('contentEl' in view)) return null;

      // Access the webview element
      const viewWithContent = view as unknown as { contentEl: HTMLElement };
      const webviewEl = viewWithContent.contentEl?.querySelector('webview');

      if (!webviewEl) return null;

      // Check if webview has required methods (Electron webview)
      const webview = webviewEl as HTMLElement & {
        getWebContentsId?: () => number;
        getURL?: () => string;
        getTitle?: () => string;
      };

      if (typeof webview.getWebContentsId !== 'function') {
        console.debug('[Context Provider] WebView not ready or not an Electron webview');
        return null;
      }

      const url = webview.getURL?.() || '';
      const title = webview.getTitle?.() || url;

      // Try to access Electron's remote API - may not be available in all Obsidian versions
      type ElectronRemote = { webContents: { fromId: (id: number) => { executeJavaScript: (code: string, userGesture: boolean) => Promise<unknown> } | null } };
      let remote: ElectronRemote | null = null;
      try {
        // Dynamic import to avoid build errors if electron is not available
        const electron = window.require?.('electron') as { remote?: ElectronRemote } | undefined;
        remote = electron?.remote ?? null;
      } catch {
        console.debug('[Context Provider] Electron remote module not available');
        return null;
      }

      if (!remote || !remote.webContents) {
        console.debug('[Context Provider] Electron remote API not available - this feature requires Obsidian desktop');
        return null;
      }

      const webContentsId = webview.getWebContentsId();
      if (!webContentsId) return null;

      const webContents = remote.webContents.fromId(webContentsId);
      if (!webContents) return null;

      // Extract page content as text
      const htmlContent = await webContents.executeJavaScript(`
        (function() {
          // Get page title and meta description
          const title = document.title;
          const metaDesc = document.querySelector('meta[name="description"]')?.content || '';

          // Get main text content, excluding scripts and styles
          const clone = document.body.cloneNode(true);
          const scripts = clone.querySelectorAll('script, style, noscript');
          scripts.forEach(el => el.remove());

          const textContent = clone.innerText || clone.textContent || '';

          return {
            title: title,
            description: metaDesc,
            content: textContent.trim()
          };
        })();
      `, true) as { title: string; description: string; content: string } | null;

      if (!htmlContent || !htmlContent.content) {
        return null;
      }

      // Format as markdown-style content
      const formattedContent = `# ${htmlContent.title}\n\nURL: ${url}\n\n${htmlContent.description ? `${htmlContent.description}\n\n` : ''}${htmlContent.content}`;

      return {
        type: 'webpage',
        url,
        title: htmlContent.title || title,
        content: formattedContent,
        path: url,
      };
    } catch (error) {
      // Gracefully handle any errors - web context is optional
      console.debug('[Context Provider] Web viewer context unavailable:', error instanceof Error ? error.message : 'unknown error');
      return null;
    }
  }

  async searchVault(query: string, maxResults?: number): Promise<VaultSearchResult[]> {
    const { vault, metadataCache } = this.plugin.app;
    const files = vault.getMarkdownFiles();
    const results: VaultSearchResult[] = [];
    const queryTerms = this.extractSearchTerms(query);
    // Include both user-configured exclusions and the config directory
    const excludePaths = [...this.plugin.settings.excludeFolders, vault.configDir];

    for (const file of files) {
      // Skip excluded paths
      if (excludePaths.some((p) => file.path.startsWith(p))) {
        continue;
      }

      let score = 0;
      let excerpt: string | undefined;
      let relevanceReason: string | undefined;

      const metadata = metadataCache.getFileCache(file);
      const frontmatter = this.parseFrontmatter(metadata?.frontmatter);

      // Score by filename match (highest priority)
      for (const term of queryTerms) {
        if (file.basename.toLowerCase().includes(term)) {
          score += 15;
          relevanceReason = 'filename match';
        }
      }

      // Score by frontmatter keywords (high priority for explicit tagging)
      if (frontmatter.keywords) {
        for (const keyword of frontmatter.keywords) {
          for (const term of queryTerms) {
            if (keyword.toLowerCase().includes(term)) {
              score += 12;
              relevanceReason = relevanceReason || 'keyword match';
            }
          }
        }
      }

      // Score by tags
      if (frontmatter.tags) {
        for (const tag of frontmatter.tags) {
          for (const term of queryTerms) {
            if (tag.toLowerCase().includes(term)) {
              score += 10;
              relevanceReason = relevanceReason || 'tag match';
            }
          }
        }
      }

      // Score by summary (good for semantic relevance)
      if (frontmatter.summary) {
        for (const term of queryTerms) {
          if (frontmatter.summary.toLowerCase().includes(term)) {
            score += 8;
            relevanceReason = relevanceReason || 'summary match';
          }
        }
      }

      // Score by headings
      if (metadata?.headings) {
        for (const heading of metadata.headings) {
          for (const term of queryTerms) {
            if (heading.heading.toLowerCase().includes(term)) {
              score += 6;
              relevanceReason = relevanceReason || 'heading match';
            }
          }
        }
      }

      // Score by content match (lower priority, but captures exact matches)
      const content = await vault.cachedRead(file);
      const lowerContent = content.toLowerCase();
      for (const term of queryTerms) {
        const matchIndex = lowerContent.indexOf(term);
        if (matchIndex !== -1) {
          score += 4;
          if (!excerpt) {
            const start = Math.max(0, matchIndex - 50);
            const end = Math.min(content.length, matchIndex + term.length + 100);
            excerpt = content.substring(start, end);
          }
          relevanceReason = relevanceReason || 'content match';
        }
      }

      // Bonus for active/current status
      if (frontmatter.status === 'active' || frontmatter.status === 'wip') {
        score += 3;
      }

      if (score > 0) {
        results.push({
          file,
          path: file.path,
          title: frontmatter.title || file.basename,
          excerpt,
          score,
          relevanceReason,
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults || this.plugin.settings.maxContextFiles);
  }

  /**
   * Get related files via wikilinks from the current note
   */
  getRelatedFiles(file: TFile, maxDepth: number = 1): TFile[] {
    const { vault, metadataCache } = this.plugin.app;
    const related: Set<string> = new Set();
    const visited: Set<string> = new Set();

    const collectLinks = (currentFile: TFile, depth: number): void => {
      if (depth > maxDepth || visited.has(currentFile.path)) return;
      visited.add(currentFile.path);

      const metadata = metadataCache.getFileCache(currentFile);

      // Get links from the file
      if (metadata?.links) {
        for (const link of metadata.links) {
          const linkedFile = metadataCache.getFirstLinkpathDest(link.link, currentFile.path);
          if (linkedFile && linkedFile instanceof TFile) {
            related.add(linkedFile.path);
          }
        }
      }

      // Get frontmatter related links
      const frontmatter = this.parseFrontmatter(metadata?.frontmatter);
      if (frontmatter.related) {
        for (const relatedLink of frontmatter.related) {
          // Parse [[wikilink]] format
          const linkMatch = relatedLink.match(/\[\[([^\]]+)\]\]/);
          const linkPath = linkMatch ? linkMatch[1] : relatedLink;
          const linkedFile = metadataCache.getFirstLinkpathDest(linkPath, currentFile.path);
          if (linkedFile && linkedFile instanceof TFile) {
            related.add(linkedFile.path);
          }
        }
      }

      // Get backlinks (files that link TO this file)
      // Note: We scan all files to find backlinks since metadataCache doesn't expose this directly
      const allFiles = vault.getMarkdownFiles();
      for (const otherFile of allFiles) {
        if (otherFile.path === currentFile.path) continue;
        const otherMeta = metadataCache.getFileCache(otherFile);
        if (otherMeta?.links) {
          for (const link of otherMeta.links) {
            const linkedFile = metadataCache.getFirstLinkpathDest(link.link, otherFile.path);
            if (linkedFile && linkedFile.path === currentFile.path) {
              related.add(otherFile.path);
              break;
            }
          }
        }
      }
    };

    collectLinks(file, 0);

    // Convert paths back to files
    const relatedFiles: TFile[] = [];
    for (const path of related) {
      if (path !== file.path) {
        const relatedFile = vault.getAbstractFileByPath(path);
        if (relatedFile instanceof TFile) {
          relatedFiles.push(relatedFile);
        }
      }
    }

    return relatedFiles;
  }

  private parseFrontmatter(frontmatter?: FrontMatterCache): ParsedFrontmatter {
    if (!frontmatter) return {};

    return {
      title: frontmatter.title as string | undefined,
      tags: this.normalizeArray(frontmatter.tags),
      keywords: this.normalizeArray(frontmatter.keywords),
      related: this.normalizeArray(frontmatter.related),
      summary: frontmatter.summary as string | undefined,
      type: frontmatter.type as string | undefined,
      status: frontmatter.status as string | undefined,
    };
  }

  private normalizeArray(value: unknown): string[] | undefined {
    if (!value) return undefined;
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'string') return value.split(',').map((s) => s.trim());
    return undefined;
  }

  /**
   * Extract meaningful search terms from a query
   */
  private extractSearchTerms(query: string): string[] {
    // Common stop words to filter out
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that',
      'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
      'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'each',
      'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
      'no', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
      'just', 'about', 'into', 'through', 'during', 'before', 'after',
      'above', 'below', 'between', 'under', 'again', 'further', 'then',
      'once', 'here', 'there', 'any', 'me', 'my', 'help', 'find', 'show',
      'get', 'tell', 'give', 'please', 'want', 'need', 'look', 'see',
    ]);

    return query
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter((term) => term.length > 2 && !stopWords.has(term));
  }

  private metadataMatchesQuery(metadata: CachedMetadata, query: string): boolean {
    if (metadata.tags?.some((t) => t.tag.toLowerCase().includes(query))) {
      return true;
    }
    if (metadata.headings?.some((h) => h.heading.toLowerCase().includes(query))) {
      return true;
    }
    return false;
  }

  async gatherContext(query: string, additionalFiles?: TFile[]): Promise<ContextGatheringResult> {
    const contexts: ContextReference[] = [];
    const includedPaths: Set<string> = new Set();
    let totalLength = 0;
    const maxLength = this.plugin.settings.maxContextLength;

    const addContext = async (file: TFile, reason?: string): Promise<boolean> => {
      if (includedPaths.has(file.path)) return false;

      const content = await this.plugin.app.vault.cachedRead(file);
      if (totalLength + content.length >= maxLength) return false;

      const metadata = this.plugin.app.metadataCache.getFileCache(file);
      const frontmatter = this.parseFrontmatter(metadata?.frontmatter);

      contexts.push({
        type: 'file',
        path: file.path,
        title: frontmatter.title || file.basename,
        content,
      });
      includedPaths.add(file.path);
      totalLength += content.length;
      return true;
    };

    // 1. Include current note if setting enabled
    if (this.plugin.settings.includeCurrentNote) {
      const activeFile = this.plugin.app.workspace.getActiveFile();
      if (activeFile && activeFile.extension === 'md') {
        await addContext(activeFile, 'active file');

        // 2. Include related files from the current note (via wikilinks)
        const relatedFiles = await this.getRelatedFiles(activeFile, 1);
        for (const relatedFile of relatedFiles.slice(0, 3)) {
          // Limit to 3 related files
          if (totalLength >= maxLength * 0.5) break; // Reserve space for search results
          await addContext(relatedFile, 'related via wikilink');
        }
      }
    }

    // 3. Add explicitly provided files
    if (additionalFiles) {
      for (const file of additionalFiles) {
        await addContext(file, 'explicitly provided');
      }
    }

    // 4. Search for relevant files based on query
    const searchResults = await this.searchVault(query);

    for (const result of searchResults) {
      if (!await addContext(result.file, result.relevanceReason)) {
        break;
      }
    }

    return {
      files: contexts,
      totalLength,
      truncated: totalLength >= maxLength,
    };
  }

  formatContextForPrompt(contexts: ContextReference[]): string {
    if (contexts.length === 0) return '';

    const formatted = contexts
      .map((ctx) => {
        return `--- File: ${ctx.path} ---\n${ctx.content}\n--- End File ---`;
      })
      .join('\n\n');

    return `Here is relevant context from the vault:\n\n${formatted}\n\n`;
  }

  /**
   * Get lightweight vault awareness context - minimal info to help Claude navigate
   * without sending file contents upfront. Claude can use Read/Grep/Glob tools on demand.
   */
  getVaultAwareness(includeCurrentFile: boolean = true): string {
    const { vault } = this.plugin.app;
    const adapter = vault.adapter as { basePath?: string };
    const vaultPath = adapter.basePath || vault.getName();

    // Get top-level folder structure
    const rootItems = vault.getRoot().children;
    const folders = rootItems
      .filter((item) => item instanceof TFile === false)
      .map((folder) => folder.name)
      .filter((name) => !name.startsWith('.'))
      .sort();

    // Count files
    const totalFiles = vault.getMarkdownFiles().length;

    // Build awareness prompt
    let awareness = `You are working in an Obsidian vault located at: ${vaultPath}

This vault contains ${totalFiles} markdown files organized in these folders:
${folders.map((f) => `- ${f}/`).join('\n')}

To explore the vault, use your tools:
- Use Glob to find files by pattern (e.g., "**/*.md", "Meeting Notes/**/*.md")
- Use Grep to search file contents
- Use Read to read specific files

Do NOT ask me to provide file contents - use your tools to read them directly.`;

    // Add current file info if enabled and available
    if (includeCurrentFile) {
      const activeFile = this.plugin.app.workspace.getActiveFile();
      if (activeFile && activeFile.extension === 'md') {
        const metadata = this.plugin.app.metadataCache.getFileCache(activeFile);
        const frontmatter = this.parseFrontmatter(metadata?.frontmatter);

        awareness += `\n\nThe user currently has this file open: ${activeFile.path}`;
        if (frontmatter.title) {
          awareness += `\n  Title: ${frontmatter.title}`;
        }
        if (frontmatter.tags && frontmatter.tags.length > 0) {
          awareness += `\n  Tags: ${frontmatter.tags.join(', ')}`;
        }
        if (frontmatter.summary) {
          awareness += `\n  Summary: ${frontmatter.summary}`;
        }
        awareness += `\nIf the user's question seems related to this file, read it with the Read tool.`;
      }
    }

    return awareness + '\n\n';
  }

  /**
   * Get lightweight current file reference (just path, not content)
   */
  getCurrentFileReference(): { path: string; title: string } | null {
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== 'md') {
      return null;
    }
    const metadata = this.plugin.app.metadataCache.getFileCache(activeFile);
    const frontmatter = this.parseFrontmatter(metadata?.frontmatter);
    return {
      path: activeFile.path,
      title: frontmatter.title || activeFile.basename,
    };
  }
}
