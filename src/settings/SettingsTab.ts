import { App, PluginSettingTab, Setting, Notice, Platform } from 'obsidian';
import { exec } from 'child_process';
import { promisify } from 'util';
import type ClaudeCodePlugin from '../main';

const execAsync = promisify(exec);

/**
 * Get platform-appropriate PATH for finding CLI tools
 */
function getExtendedPath(): string {
  const basePath = process.env.PATH || '';

  if (Platform.isMacOS) {
    return `/opt/homebrew/bin:/usr/local/bin:${basePath}`;
  } else if (Platform.isLinux) {
    const home = process.env.HOME || '';
    return `/usr/local/bin:${home}/.local/bin:${basePath}`;
  } else if (Platform.isWin) {
    const appData = process.env.APPDATA || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    return `${appData}\\npm;${localAppData}\\npm;${basePath}`;
  }

  return basePath;
}

// Patterns that indicate potentially unsafe paths
const UNSAFE_PATH_PATTERNS = [
  /[;&|`$(){}[\]<>]/,  // Shell metacharacters
  /\.\./,              // Directory traversal
  /^https?:/i,         // URLs
];

/**
 * Validates that a path looks like a safe CLI executable path
 */
function isValidCliPath(path: string): { valid: boolean; reason?: string } {
  if (!path || path.trim().length === 0) {
    return { valid: false, reason: 'Path cannot be empty' };
  }

  const trimmed = path.trim();

  // Check for shell metacharacters that could indicate command injection
  for (const pattern of UNSAFE_PATH_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, reason: 'Path contains invalid characters' };
    }
  }

  // Path should be a simple name (in PATH) or an absolute/relative path
  // Simple names: "claude", "claude-code"
  // Paths: "/usr/local/bin/claude", "./claude", "~/bin/claude"
  const validPathPattern = /^[a-zA-Z0-9_.~\/-]+$/;
  if (!validPathPattern.test(trimmed)) {
    return { valid: false, reason: 'Path contains invalid characters' };
  }

  return { valid: true };
}

export class ClaudeCodeSettingsTab extends PluginSettingTab {
  plugin: ClaudeCodePlugin;

  constructor(app: App, plugin: ClaudeCodePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Claude Code Settings' });

    // Connection Status
    this.renderConnectionStatus(containerEl);

    // CLI Configuration
    containerEl.createEl('h3', { text: 'CLI Configuration' });

    new Setting(containerEl)
      .setName('Claude CLI Path')
      .setDesc('Path to the Claude CLI executable. Leave as "claude" to use PATH, or specify full path.')
      .addText((text) =>
        text
          .setPlaceholder('claude')
          .setValue(this.plugin.settings.claudePath)
          .onChange(async (value) => {
            const pathToSet = value || 'claude';
            const validation = isValidCliPath(pathToSet);
            if (!validation.valid) {
              new Notice(`Invalid path: ${validation.reason}`);
              return;
            }
            this.plugin.settings.claudePath = pathToSet;
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText('Auto-detect')
          .onClick(async () => {
            const detected = await this.detectClaudePath();
            if (detected) {
              this.plugin.settings.claudePath = detected;
              await this.plugin.saveSettings();
              this.display(); // Refresh
              new Notice(`Claude CLI found: ${detected}`);
            } else {
              new Notice('Could not auto-detect Claude CLI. Please install it first.');
            }
          })
      );

    new Setting(containerEl)
      .setName('Default Allowed Tools')
      .setDesc('Comma-separated list of tools to auto-approve')
      .addText((text) =>
        text
          .setPlaceholder('Read,Glob,Grep')
          .setValue(this.plugin.settings.defaultAllowedTools.join(','))
          .onChange(async (value) => {
            this.plugin.settings.defaultAllowedTools = value
              .split(',')
              .map((t) => t.trim())
              .filter((t) => t);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Max Turns')
      .setDesc('Maximum agentic turns per request')
      .addSlider((slider) =>
        slider
          .setLimits(1, 50, 1)
          .setValue(this.plugin.settings.maxTurns)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxTurns = value;
            await this.plugin.saveSettings();
          })
      );

    // Skills Configuration
    containerEl.createEl('h3', { text: 'Skills Configuration' });

    new Setting(containerEl)
      .setName('Skills Folder')
      .setDesc('Path to folder containing custom skills (relative to vault root). Each skill should be a folder with a SKILL.md file.')
      .addText((text) =>
        text
          .setPlaceholder('.claude/skills')
          .setValue(this.plugin.settings.skillsFolder)
          .onChange(async (value) => {
            this.plugin.settings.skillsFolder = value || '.claude/skills';
            await this.plugin.saveSettings();
            // Reload skills when folder changes
            await this.plugin.skillLoader.loadSkills();
          })
      );

    const skillsInfo = containerEl.createDiv('setting-item-description');
    skillsInfo.style.marginTop = '-10px';
    skillsInfo.style.marginBottom = '15px';
    skillsInfo.innerHTML = `
      <small>
        <strong>Tip:</strong> Use the built-in <code>/skill-creator</code> command to create new skills.
        Skills extend Claude's capabilities with specialized workflows and knowledge.
      </small>
    `;

    // Context Settings
    containerEl.createEl('h3', { text: 'Context Settings' });

    new Setting(containerEl)
      .setName('Include Current Note')
      .setDesc('Automatically include the active note as context')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.includeCurrentNote).onChange(async (value) => {
          this.plugin.settings.includeCurrentNote = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Max Context Files')
      .setDesc('Maximum number of files to include as context')
      .addSlider((slider) =>
        slider
          .setLimits(1, 50, 1)
          .setValue(this.plugin.settings.maxContextFiles)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxContextFiles = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Max Context Length')
      .setDesc('Maximum total characters for context')
      .addText((text) =>
        text.setValue(this.plugin.settings.maxContextLength.toString()).onChange(async (value) => {
          const num = parseInt(value);
          if (!isNaN(num) && num > 0) {
            this.plugin.settings.maxContextLength = num;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('Excluded Folders')
      .setDesc('Comma-separated list of folders to exclude from context')
      .addText((text) =>
        text
          .setPlaceholder('.obsidian,.claude-sessions')
          .setValue(this.plugin.settings.excludeFolders.join(','))
          .onChange(async (value) => {
            this.plugin.settings.excludeFolders = value
              .split(',')
              .map((f) => f.trim())
              .filter((f) => f);
            await this.plugin.saveSettings();
          })
      );

    // UI Preferences
    containerEl.createEl('h3', { text: 'UI Preferences' });

    new Setting(containerEl)
      .setName('Show Tool Calls')
      .setDesc('Display tool usage in the chat interface')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showToolCalls).onChange(async (value) => {
          this.plugin.settings.showToolCalls = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Stream Responses')
      .setDesc('Show responses as they stream in')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.streamResponses).onChange(async (value) => {
          this.plugin.settings.streamResponses = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Default Panel Position')
      .setDesc('Where to open the chat panel')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('left', 'Left')
          .addOption('right', 'Right')
          .setValue(this.plugin.settings.defaultPanelPosition)
          .onChange(async (value: 'left' | 'right') => {
            this.plugin.settings.defaultPanelPosition = value;
            await this.plugin.saveSettings();
          })
      );

    // Session Management
    containerEl.createEl('h3', { text: 'Session Management' });

    new Setting(containerEl)
      .setName('Auto-save Sessions')
      .setDesc('Automatically save conversations')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoSaveSessions).onChange(async (value) => {
          this.plugin.settings.autoSaveSessions = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Session Storage Path')
      .setDesc('Folder path for storing session files')
      .addText((text) =>
        text
          .setPlaceholder('.claude-sessions')
          .setValue(this.plugin.settings.sessionStoragePath)
          .onChange(async (value) => {
            this.plugin.settings.sessionStoragePath = value || '.claude-sessions';
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Max Session History')
      .setDesc('Number of sessions to retain')
      .addSlider((slider) =>
        slider
          .setLimits(10, 200, 10)
          .setValue(this.plugin.settings.maxSessionHistory)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxSessionHistory = value;
            await this.plugin.saveSettings();
          })
      );
  }

  private async renderConnectionStatus(containerEl: HTMLElement): Promise<void> {
    const statusContainer = containerEl.createDiv('claude-connection-status');
    statusContainer.style.cssText = 'padding: 15px; margin-bottom: 20px; border-radius: 8px; border: 1px solid var(--background-modifier-border);';

    const statusText = statusContainer.createDiv();
    const loadingSpan = statusText.createSpan();
    loadingSpan.style.opacity = '0.7';
    loadingSpan.textContent = 'Checking Claude CLI connection...';

    // Check connection status asynchronously
    const isConnected = await this.checkClaudeConnection();

    statusContainer.empty();

    if (isConnected) {
      statusContainer.style.borderColor = 'var(--color-green)';
      statusContainer.style.backgroundColor = 'rgba(0, 200, 0, 0.1)';

      const wrapper = statusContainer.createDiv();
      wrapper.style.cssText = 'display: flex; align-items: center; gap: 10px;';

      const icon = wrapper.createSpan();
      icon.style.fontSize = '1.5em';
      icon.textContent = '✅';

      const infoDiv = wrapper.createDiv();
      infoDiv.createEl('strong', { text: 'Claude CLI Connected' });
      const pathDiv = infoDiv.createDiv();
      pathDiv.style.cssText = 'opacity: 0.8; font-size: 0.9em;';
      pathDiv.textContent = `Path: ${this.plugin.settings.claudePath}`;
    } else {
      statusContainer.style.borderColor = 'var(--color-orange)';
      statusContainer.style.backgroundColor = 'rgba(255, 165, 0, 0.1)';

      const contentDiv = statusContainer.createDiv();
      contentDiv.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';

      // Header row
      const headerRow = contentDiv.createDiv();
      headerRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';
      const warnIcon = headerRow.createSpan();
      warnIcon.style.fontSize = '1.5em';
      warnIcon.textContent = '⚠️';
      const headerInfo = headerRow.createDiv();
      headerInfo.createEl('strong', { text: 'Setup Required' });
      const subText = headerInfo.createDiv();
      subText.style.cssText = 'opacity: 0.8; font-size: 0.9em;';
      subText.textContent = 'Claude Code CLI needs to be installed';

      // Setup steps
      const stepsBox = contentDiv.createDiv();
      stepsBox.style.cssText = 'background: var(--background-primary); padding: 12px; border-radius: 6px; font-size: 0.9em;';
      stepsBox.createEl('strong', { text: 'Setup Steps:' });

      const stepsList = stepsBox.createEl('ol');
      stepsList.style.cssText = 'margin: 8px 0 0 0; padding-left: 20px;';

      const step1 = stepsList.createEl('li');
      step1.style.marginBottom = '6px';
      step1.appendText('Install ');
      const nodeLink = step1.createEl('a', { text: 'Node.js', href: 'https://nodejs.org' });
      nodeLink.style.color = 'var(--text-accent)';
      step1.appendText(' (if not already installed)');

      const step2 = stepsList.createEl('li');
      step2.style.marginBottom = '6px';
      step2.appendText('Open Terminal and run:');
      step2.createEl('br');
      const code1 = step2.createEl('code', { text: 'npm install -g @anthropic-ai/claude-code' });
      code1.style.cssText = 'background: var(--background-secondary); padding: 2px 6px; border-radius: 3px;';

      const step3 = stepsList.createEl('li');
      step3.style.marginBottom = '6px';
      step3.appendText('Run ');
      const code2 = step3.createEl('code', { text: 'claude' });
      code2.style.cssText = 'background: var(--background-secondary); padding: 2px 6px; border-radius: 3px;';
      step3.appendText(' to authenticate with your Anthropic account');

      const step4 = stepsList.createEl('li');
      step4.textContent = 'Click "Auto-detect" below or restart Obsidian';

      // Add helpful buttons
      const buttonRow = contentDiv.createDiv();
      buttonRow.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap;';

      const docsBtn = buttonRow.createEl('button', { text: '📖 Installation Guide', cls: 'mod-cta' });
      docsBtn.style.cssText = 'font-size: 0.85em;';
      docsBtn.addEventListener('click', () => {
        window.open('https://docs.anthropic.com/en/docs/claude-code', '_blank');
      });

      const checkBtn = buttonRow.createEl('button', { text: '🔄 Check Again' });
      checkBtn.style.cssText = 'font-size: 0.85em;';
      checkBtn.addEventListener('click', () => {
        this.display();
      });
    }
  }

  private async checkClaudeConnection(): Promise<boolean> {
    try {
      const claudePath = this.plugin.settings.claudePath;
      const { stdout } = await execAsync(`"${claudePath}" --version`, {
        timeout: 5000,
        env: {
          ...process.env,
          PATH: getExtendedPath(),
        },
      });
      return stdout.includes('claude') || stdout.length > 0;
    } catch {
      return false;
    }
  }

  private async detectClaudePath(): Promise<string | null> {
    const possiblePaths: string[] = ['claude']; // Start with PATH lookup

    if (Platform.isMacOS) {
      possiblePaths.push(
        '/opt/homebrew/bin/claude',  // Homebrew ARM
        '/usr/local/bin/claude',     // Homebrew Intel
      );
    } else if (Platform.isLinux) {
      const home = process.env.HOME || '';
      possiblePaths.push(
        '/usr/local/bin/claude',
        '/usr/bin/claude',
        `${home}/.local/bin/claude`,
        `${home}/.npm-global/bin/claude`,
      );
    } else if (Platform.isWin) {
      const appData = process.env.APPDATA || '';
      const localAppData = process.env.LOCALAPPDATA || '';
      possiblePaths.push(
        `${appData}\\npm\\claude.cmd`,
        `${localAppData}\\npm\\claude.cmd`,
        `${appData}\\npm\\claude`,
        `${localAppData}\\npm\\claude`,
      );
    }

    // Try platform-specific path lookup command
    try {
      const lookupCmd = Platform.isWin ? 'where claude' : 'which claude';
      const { stdout } = await execAsync(lookupCmd, { timeout: 3000 });
      const foundPath = stdout.trim().split('\n')[0]; // Take first result on Windows
      if (foundPath && !possiblePaths.includes(foundPath)) {
        possiblePaths.unshift(foundPath);
      }
    } catch {
      // Lookup failed, continue with other paths
    }

    for (const path of possiblePaths) {
      try {
        await execAsync(`"${path}" --version`, {
          timeout: 3000,
          env: {
            ...process.env,
            PATH: getExtendedPath(),
          },
        });
        return path;
      } catch {
        continue;
      }
    }

    return null;
  }
}
