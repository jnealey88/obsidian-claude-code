# Claude Code for Obsidian

An AI assistant that lives in your Obsidian vault. Chat with Claude and let it read, write, and edit your notes directly.

## What This Plugin Does

- **Chat with Claude** in a sidebar panel
- **Claude can access your vault** - read files, search content, make edits
- **Custom Skills** - teach Claude specialized workflows for your use case
- **Session History** - save and resume conversations

---

## Quick Start

### Step 1: Install Claude Code CLI

This plugin requires the Claude Code command-line tool. Here's how to install it:

#### Check if you have Node.js

Open **Terminal** (Mac) or **Command Prompt** (Windows) and run:
```bash
node --version
```

If you see a version number (like `v18.0.0`), you're good. If not, [download Node.js](https://nodejs.org/) first.

#### Install Claude Code

In Terminal/Command Prompt, run:
```bash
npm install -g @anthropic-ai/claude-code
```

#### Authenticate

Run this command and follow the prompts to log in with your Anthropic account:
```bash
claude
```

### Step 2: Install the Plugin

1. Download this plugin folder to your vault:
   ```
   YourVault/.obsidian/plugins/obsidian-claude-code/
   ```

2. In Obsidian, go to **Settings → Community plugins**

3. Click **Reload plugins**, then enable **Claude Code**

### Step 3: Verify Setup

1. Go to **Settings → Claude Code**
2. You should see a green "✅ Claude CLI Connected" message
3. If not, click **Auto-detect** or follow the setup instructions shown

---

## How to Use

### Basic Chat

1. Click the **chat bubble icon** in the left ribbon (or use Command Palette → "Open Claude Chat Panel")
2. Type your message and press **Enter**
3. Claude responds and can use tools to work with your vault

### What Claude Can Do

| Action | Example |
|--------|---------|
| Read files | "What's in my meeting notes from yesterday?" |
| Search vault | "Find all notes mentioning Project X" |
| Edit files | "Add a summary section to this note" |
| Create files | "Create a new note for today's standup" |
| Run commands | "List all markdown files in the Projects folder" |

### Using Skills

Skills are specialized modes that give Claude specific instructions for certain tasks.

1. Select a skill from the **Mode** dropdown (above the chat input)
2. Type your request
3. Claude follows the skill's workflow

**Built-in:** Skill Creator - helps you create new skills

---

## Creating Custom Skills

Skills live in your vault at `.claude/skills/` (configurable in settings).

### Quick Example

Create a folder `.claude/skills/daily-note/` with a `SKILL.md` file:

```markdown
---
name: daily-note
description: Create daily notes with consistent formatting. Use when starting a new day or journaling.
---

# Daily Note Creator

Create daily notes with this structure:
- Date header
- Morning intentions
- Tasks for today
- Evening reflection section

Always save to the Journal/ folder with filename YYYY-MM-DD.md
```

After creating, restart Obsidian and your skill appears in the Mode dropdown.

### Skill Structure

```
.claude/skills/
└── my-skill/
    ├── SKILL.md          # Required - instructions for Claude
    ├── scripts/          # Optional - automation scripts
    ├── references/       # Optional - docs Claude can read
    └── assets/           # Optional - templates, images
```

---

## Settings

| Setting | Description |
|---------|-------------|
| **Claude CLI Path** | Usually auto-detected. Click "Auto-detect" if needed. |
| **Skills Folder** | Where to find skills (default: `.claude/skills`) |
| **Max Turns** | How many actions Claude can take per request |
| **Include Current Note** | Auto-include the open note as context |
| **Show Tool Calls** | See what tools Claude uses |
| **Session Storage** | Where chat history is saved |

---

## Troubleshooting

### "Claude CLI Not Found"

1. Open Terminal and run `claude --version`
2. If it works there but not in Obsidian, click **Auto-detect** in settings
3. Or manually enter the path (run `which claude` to find it)

### Skills Not Appearing

1. Check the Skills Folder path in settings matches where your skills are
2. Each skill needs a `SKILL.md` file
3. Try restarting Obsidian after adding skills

### Chat Not Responding

1. Check the connection status in settings
2. Run `claude` in Terminal to verify authentication
3. Check Obsidian's developer console (Cmd+Opt+I) for errors

### "Command not found: npm"

You need Node.js installed. [Download it here](https://nodejs.org/).

---

## FAQ

**Q: Do I need a paid Anthropic account?**
A: Yes, Claude Code requires an Anthropic account with API access.

**Q: Is my data sent to Anthropic?**
A: Only the content you chat about. Claude Code runs locally and sends prompts to Anthropic's API.

**Q: Can Claude edit any file?**
A: Claude can only access files within your Obsidian vault.

**Q: How do I stop Claude mid-response?**
A: Click the **Stop** button that appears while Claude is responding.

---

## Requirements

- **Obsidian** 1.4.0 or later
- **Node.js** 18 or later
- **Claude Code CLI** (installed via npm)
- **Anthropic account** with API access

---

## Support

- [Claude Code Documentation](https://docs.anthropic.com/en/docs/claude-code)
- [Report Issues](https://github.com/your-repo/obsidian-claude-code/issues)

---

Created by Nealey • Powered by [Claude Code](https://claude.ai/claude-code) by Anthropic
