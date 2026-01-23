import { FileSystemAdapter } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import type ClaudeCodePlugin from '../main';

export interface SkillOption {
  id: string;
  name: string;
  description: string;
  icon: string;
  isBuiltIn?: boolean;
  skillPath?: string;
}

// Built-in skill-creator that's always available
const BUILTIN_SKILL_CREATOR: SkillOption = {
  id: 'skill-creator',
  name: 'Skill Creator',
  description: 'Guide for creating effective skills. Use when you want to create a new skill (or update an existing skill) that extends Claude\'s capabilities with specialized knowledge, workflows, or tool integrations.',
  icon: '🛠️',
  isBuiltIn: true,
};

// Built-in skill-creator SKILL.md content
const BUILTIN_SKILL_CREATOR_CONTENT = `---
name: skill-creator
description: Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends Claude's capabilities with specialized knowledge, workflows, or tool integrations.
---

# Skill Creator

This skill provides guidance for creating effective skills for this Obsidian vault.

## About Skills

Skills are modular, self-contained packages that extend Claude's capabilities by providing specialized knowledge, workflows, and tools. Think of them as "onboarding guides" for specific domains or tasks—they transform Claude from a general-purpose agent into a specialized agent equipped with procedural knowledge.

### What Skills Provide

1. **Specialized workflows** - Multi-step procedures for specific domains
2. **Tool integrations** - Instructions for working with specific file formats or APIs
3. **Domain expertise** - Company-specific knowledge, schemas, business logic
4. **Bundled resources** - Scripts, references, and assets for complex and repetitive tasks

## Skill Structure

Every skill consists of a required SKILL.md file and optional bundled resources:

\`\`\`
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter metadata (required)
│   │   ├── name: (required)
│   │   └── description: (required)
│   └── Markdown instructions (required)
└── Bundled Resources (optional)
    ├── scripts/          - Executable code (Python/Bash/etc.)
    ├── references/       - Documentation intended to be loaded into context as needed
    └── assets/           - Files used in output (templates, icons, fonts, etc.)
\`\`\`

### SKILL.md Requirements

Every SKILL.md must have:

- **Frontmatter** (YAML): Contains \`name\` and \`description\` fields
  - \`name\`: The skill identifier (hyphen-case, e.g., "my-skill")
  - \`description\`: Clear explanation of what the skill does AND when to use it
- **Body** (Markdown): Instructions and guidance for using the skill

### Bundled Resources

#### scripts/
Executable code (Python/Bash/etc.) for tasks requiring deterministic reliability.
- Include when the same code is being rewritten repeatedly
- Scripts can be executed without loading into context

#### references/
Documentation loaded into context as needed.
- Database schemas, API documentation, domain knowledge
- Keep files under 100 lines when possible, include TOC for longer files

#### assets/
Files used in output (not loaded into context).
- Templates, images, icons, boilerplate code, fonts

## Creating a New Skill

### Step 1: Plan the Skill

Before creating, determine:
1. What specific tasks should this skill handle?
2. What resources (scripts, references, assets) would be helpful?
3. When should Claude automatically recognize to use this skill?

### Step 2: Create the Skill Directory

Create a new folder in the skills directory with this structure:

\`\`\`bash
# In your vault's skills folder (default: .claude/skills/)
mkdir -p my-new-skill
\`\`\`

### Step 3: Create SKILL.md

Create the SKILL.md file with required frontmatter:

\`\`\`yaml
---
name: my-new-skill
description: [Clear description of what the skill does]. Use when [specific scenarios that trigger this skill].
---

# My New Skill

## Overview
[1-2 sentences explaining what this skill enables]

## Usage
[Instructions for how to use the skill]

## [Additional sections as needed]
\`\`\`

### Step 4: Add Resources (Optional)

Add any supporting resources:
- \`scripts/\` - Python/Bash scripts for automation
- \`references/\` - Documentation and guides
- \`assets/\` - Templates and files for output

### Step 5: Test the Skill

After creating the skill:
1. Reload the plugin settings or restart Obsidian
2. The skill should appear in the Mode dropdown
3. Test with relevant prompts to ensure it triggers correctly

## Best Practices

### Writing Good Descriptions

The description is critical - it determines when Claude uses the skill:

**Good:** "Process meeting notes to extract action items, decisions, and key discussion points. Use when reviewing meeting transcripts, summarizing discussions, or creating follow-up task lists."

**Bad:** "Meeting notes skill"

### Keep SKILL.md Concise

- Claude is already very smart - only add context it doesn't have
- Challenge each piece of information: "Does this justify its token cost?"
- Prefer concise examples over verbose explanations
- Target under 500 lines; split into references if longer

### Set Appropriate Degrees of Freedom

- **High freedom**: Text instructions for contextual decisions
- **Medium freedom**: Pseudocode or scripts with parameters
- **Low freedom**: Specific scripts for fragile operations

## Example Skills

### Simple Task Skill
\`\`\`yaml
---
name: code-review
description: Review code for quality, security, and best practices. Use when asked to review PRs, audit code, or suggest improvements.
---

# Code Review

## Review Checklist
1. Security vulnerabilities (OWASP top 10)
2. Performance issues
3. Code style and readability
4. Test coverage
5. Documentation

## Output Format
Provide findings as:
- 🔴 Critical issues (must fix)
- 🟡 Suggestions (should consider)
- 🟢 Good practices (already doing well)
\`\`\`

### Skill with Scripts
\`\`\`yaml
---
name: data-processor
description: Process and transform data files. Use for CSV manipulation, JSON transformation, or data cleaning tasks.
---

# Data Processor

## Available Scripts

- \`scripts/csv_cleaner.py\` - Remove duplicates and empty rows
- \`scripts/json_transformer.py\` - Transform JSON structure

## Usage
Specify the input file and desired transformation.
\`\`\`
`;

// Default icon mapping for known skill names
const DEFAULT_ICONS: Record<string, string> = {
  'skill-creator': '🛠️',
  tasks: '✅',
  meeting: '📝',
  prfaq: '📄',
  blog: '✍️',
  research: '🔍',
  oneone: '👤',
  project: '📊',
  perf: '🏆',
  audit: '🗂️',
  jira: '🎫',
  feedback: '💬',
  metrics: '📈',
  confluence: '🔄',
  fullstory: '🎬',
  changelog: '📋',
  competitive: '🏁',
  scrape: '🕷️',
};

export class SkillLoaderService {
  private plugin: ClaudeCodePlugin;
  private skills: SkillOption[] = [];

  constructor(plugin: ClaudeCodePlugin) {
    this.plugin = plugin;
  }

  async loadSkills(): Promise<SkillOption[]> {
    try {
      // Always include General as the first option
      this.skills = [
        { id: '', name: 'General', description: 'General assistant', icon: '💬' },
      ];

      // Always include built-in skill-creator
      this.skills.push(BUILTIN_SKILL_CREATOR);

      // Load skills from configured skills folder
      const folderSkills = await this.loadSkillsFromFolder();

      // Sort folder skills alphabetically by name
      folderSkills.sort((a, b) => a.name.localeCompare(b.name));

      this.skills.push(...folderSkills);

      console.debug('[Skill Loader] Loaded', this.skills.length - 1, 'skills (1 built-in +', folderSkills.length, 'from folder)');

      return this.skills;
    } catch (error) {
      console.error('[Skill Loader] Error loading skills:', error);
      return this.skills;
    }
  }

  private loadSkillsFromFolder(): SkillOption[] {
    const skills: SkillOption[] = [];

    try {
      // Get vault path
      let vaultPath = '';
      if (this.plugin.app.vault.adapter instanceof FileSystemAdapter) {
        vaultPath = this.plugin.app.vault.adapter.getBasePath();
      }

      if (!vaultPath) {
        console.debug('[Skill Loader] Could not determine vault path');
        return skills;
      }

      const skillsFolder = this.plugin.settings.skillsFolder;
      const skillsFolderPath = path.join(vaultPath, skillsFolder);

      console.debug('[Skill Loader] Looking for skills in:', skillsFolderPath);

      if (!fs.existsSync(skillsFolderPath)) {
        console.debug('[Skill Loader] Skills folder does not exist:', skillsFolderPath);
        return skills;
      }

      // Read all directories in the skills folder
      const entries = fs.readdirSync(skillsFolderPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        // Skip skill-creator since we have a built-in version
        if (entry.name === 'skill-creator') continue;

        const skillDir = path.join(skillsFolderPath, entry.name);
        const skillMdPath = path.join(skillDir, 'SKILL.md');

        if (!fs.existsSync(skillMdPath)) {
          console.debug('[Skill Loader] No SKILL.md found in:', skillDir);
          continue;
        }

        try {
          const skillContent = fs.readFileSync(skillMdPath, 'utf-8');
          const parsed = this.parseSkillMd(skillContent, entry.name);

          if (parsed) {
            parsed.skillPath = skillDir;
            skills.push(parsed);
            console.debug('[Skill Loader] Loaded skill:', parsed.id);
          }
        } catch (e) {
          console.error('[Skill Loader] Error parsing skill:', entry.name, e);
        }
      }
    } catch (error) {
      console.error('[Skill Loader] Error reading skills folder:', error);
    }

    return skills;
  }

  private parseSkillMd(content: string, fallbackName: string): SkillOption | null {
    let name = fallbackName;
    let description = '';

    // Try to parse YAML frontmatter first
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];

      // Parse name from frontmatter
      const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
      if (nameMatch) {
        name = nameMatch[1].trim();
      }

      // Parse description from frontmatter
      const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
      if (descMatch) {
        description = descMatch[1].trim();
      }
    }

    // If no frontmatter or missing description, try to extract from content
    if (!description) {
      // Try to get description from first heading or first paragraph
      const lines = content.split('\n').filter(line => line.trim());

      // Skip frontmatter if present
      if (frontmatterMatch) {
        const afterFrontmatter = content.indexOf('---', 4);
        if (afterFrontmatter > 0) {
          const afterContent = content.slice(afterFrontmatter + 3).trim();
          const afterLines = afterContent.split('\n').filter(line => line.trim());

          // Get first heading as title hint
          const headingMatch = afterContent.match(/^#\s+(.+)$/m);
          if (headingMatch && !name) {
            // Use heading to derive name if not in frontmatter
          }

          // Get first non-heading line as description
          for (const line of afterLines) {
            if (!line.startsWith('#') && line.trim().length > 10) {
              description = line.trim().substring(0, 200);
              break;
            }
          }
        }
      } else {
        // No frontmatter - extract from content directly
        for (const line of lines) {
          // Skip headings for description
          if (!line.startsWith('#') && line.trim().length > 10) {
            description = line.trim().substring(0, 200);
            break;
          }
        }

        // Try to get name from first heading if not set
        const headingMatch = content.match(/^#\s+(.+)$/m);
        if (headingMatch) {
          // Use folder name as ID, heading as display hint
          // name stays as fallbackName (folder name)
        }
      }
    }

    // If still no description, use a generic one based on the name
    if (!description) {
      description = `${this.formatSkillName(name)} skill`;
      console.debug('[Skill Loader] Using fallback description for:', name);
    }

    // Get icon
    const icon = DEFAULT_ICONS[name] || '⚡';

    console.debug('[Skill Loader] Parsed skill:', name, '-', description.substring(0, 50));

    return {
      id: name,
      name: this.formatSkillName(name),
      description,
      icon,
    };
  }

  private formatSkillName(skillId: string): string {
    // Convert skill ID to display name
    const nameMap: Record<string, string> = {
      'skill-creator': 'Skill Creator',
      tasks: 'Task Management',
      meeting: 'Meeting Notes',
      prfaq: 'PRFAQ',
      blog: 'Blog/Content',
      research: 'Research',
      oneone: '1:1 & Performance',
      project: 'Project Tracker',
      perf: 'Performance',
      audit: 'Vault Audit',
      jira: 'Jira Tickets',
      feedback: 'Feedback',
      metrics: 'Metrics',
      confluence: 'Confluence',
      fullstory: 'FullStory',
      changelog: 'Changelog',
      competitive: 'Competitive Intel',
      scrape: 'Site Scraper',
    };

    if (nameMap[skillId]) {
      return nameMap[skillId];
    }

    // Convert hyphen-case to Title Case
    return skillId
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  getSkills(): SkillOption[] {
    return this.skills;
  }

  /**
   * Get the content of a skill's SKILL.md file
   * Used when invoking a skill to provide instructions to Claude
   */
  getSkillContent(skillId: string): string | null {
    // Handle built-in skill-creator
    if (skillId === 'skill-creator') {
      return BUILTIN_SKILL_CREATOR_CONTENT;
    }

    // Find the skill
    const skill = this.skills.find(s => s.id === skillId);
    if (!skill || !skill.skillPath) {
      return null;
    }

    try {
      const skillMdPath = path.join(skill.skillPath, 'SKILL.md');
      if (fs.existsSync(skillMdPath)) {
        return fs.readFileSync(skillMdPath, 'utf-8');
      }
    } catch (error) {
      console.error('[Skill Loader] Error reading skill content:', skillId, error);
    }

    return null;
  }

  /**
   * Get the path to a skill's directory
   */
  getSkillPath(skillId: string): string | null {
    const skill = this.skills.find(s => s.id === skillId);
    return skill?.skillPath || null;
  }
}
