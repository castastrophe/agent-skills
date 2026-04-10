# @allons-y/agent-skills

[![CI][workflow-image]][workflow-url]
[![npm][npm-image]][npm-url]
[![npm downloads](https://img.shields.io/npm/dw/@allons-y/agent-skills?logo=npm)](https://www.npmjs.com/package/@allons-y/agent-skills)
[![Coverage][coverage-image]][coverage-url]
[![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen?logo=node.js)](https://nodejs.org)
[![Python](https://img.shields.io/badge/python-3.13-blue?logo=python)](https://python.org)
[![Conventional Commits][conventional-commits-image]][conventional-commits-url]

**Specialized agent skills for Claude that streamline common developer workflows and reduce token usage.**

Each skill is a self-contained directory with a `SKILL.md`, Python implementation scripts, and a test suite — installable directly into Claude Code via the plugin system or via `npx`.

---

## Quick Start

### Option A — Claude Code Plugin (recommended)

Register this repository as a marketplace, then install individual skills or all of them at once:

```sh
/plugin marketplace add castastrophe/agent-skills
```

Install a specific skill:

```sh
/plugin install gh-notification-summary@agent-skills
```

Install everything:

```sh
/plugin install agent-skills@agent-skills
```

### Option B — npx one-liner

No clone or install required:

```bash
# List available skills
npx @allons-y/agent-skills

# Install a specific skill to ~/.claude/skills/
npx @allons-y/agent-skills gh-notification-summary

# Install all skills
npx @allons-y/agent-skills --all

# Install to a custom directory
npx @allons-y/agent-skills gh-notification-summary --dir ~/my-skills
```

### Option C — Manual

Download the `.zip` from the [npm package](https://www.npmjs.com/package/@allons-y/agent-skills) or [GitHub releases](https://github.com/castastrophe/agent-skills/releases) and unzip into `~/.claude/skills/<skill-name>/`.

---

## Available Skills

| Skill | Description | Trigger |
|-------|-------------|---------|
| [`gh-notification-summary`](skills/gh-notification-summary/SKILL.md) | Review, summarize, and manage GitHub notifications via an interactive local dashboard | "check my GitHub notifications", `/unsub <number>`, "mark all done" |

---

## Programmatic Usage

The package exposes a `getSkills()` helper for tool builders who want to list or load skills dynamically:

```js
import { getSkills } from '@allons-y/agent-skills';

const skills = getSkills();
// [
//   {
//     name: 'gh-notification-summary',
//     path: '/path/to/skills/gh-notification-summary',
//     zipPath: '/path/to/skills/gh-notification-summary.zip',
//     description: 'Review, summarize, and manage GitHub notifications...',
//     mdPath: '/path/to/skills/gh-notification-summary/SKILL.md'
//   }
// ]
```

---

## Development

### Prerequisites

- Node.js (v24), supports `nvm use`
- Yarn
- [uv](https://docs.astral.sh/uv/) (Python package manager — handles Python version and dependency management)

### Installation

```bash
yarn install
```

### Workspace commands

This is a Yarn workspaces monorepo — each skill under `skills/` is its own workspace. Target a specific skill with `yarn workspace`:

```bash
yarn workspace @allons-y/skill-gh-notification-summary test
yarn workspace @allons-y/skill-gh-notification-summary lint
```

Or run across all skills at once:

```bash
yarn workspaces foreach -A run test
```

For full setup instructions — including Python virtual environments, running tests, linting, evals, and publishing — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Project Structure

```
agent-skills/                         # Root workspace (publishes to npm)
├── package.json                      # workspaces: ["skills/*"]
├── index.js                          # Exports getSkills()
├── bin/install.js                    # npx installer CLI
├── scripts/                          # Root orchestration scripts
│   ├── run-tests.js                  # Parallel pytest runner
│   ├── bundle-skills.js              # Zips skills for distribution
│   ├── generate-agent-yaml.js        # Generates agent.yaml
│   └── generate-plugin-manifest.js   # Generates marketplace.json
├── skills/                           # Yarn workspace members
│   └── <skill-name>/                 # Each skill is a workspace
│       ├── package.json              # private: true, skill-level scripts
│       ├── pyproject.toml            # mypy config
│       ├── requirements.txt          # Python dependencies
│       ├── SKILL.md                  # Metadata and usage docs
│       ├── scripts/                  # Python implementation
│       ├── tests/                    # pytest suite
│       └── evals/                    # Eval prompts (evals.json)
└── .github/
    └── workflows/                    # CI and release automation
```

---

## FAQ

<details>
<summary><b>What's inside a skill .zip file?</b></summary>

The `.zip` contains the full skill directory: `SKILL.md`, all scripts, and the `requirements.txt`. It is structured so that unzipping it directly into `~/.claude/skills/<skill-name>/` gives you a ready-to-use skill with no further setup.
</details>

<details>
<summary><b>How do I install a skill for use with Claude?</b></summary>

**Via Claude Code (easiest):**
```
/plugin marketplace add castastrophe/agent-skills
/plugin install gh-notification-summary@agent-skills
```

**Via npx:**
```bash
npx @allons-y/agent-skills gh-notification-summary
```

**Manually:** unzip into `~/.claude/skills/gh-notification-summary/`. Claude detects `SKILL.md` automatically on next launch.
</details>

<details>
<summary><b>How do I add a new skill or run tests?</b></summary>

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide: environment setup, running tests, linting, evals format, and PR checklist.
</details>

---

## Contributing

Contributions are welcome — new skills, improvements to existing ones, bug fixes, and documentation. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Ideas for new skills:**
- GitHub PR review summarizer
- Linear / Jira issue triage
- Slack digest summarizer
- Daily standup generator from git log

---

## License

[Apache 2.0](LICENSE) — use freely, modify as needed, contribute back if you can.

[workflow-image]: https://github.com/castastrophe/agent-skills/actions/workflows/test.yml/badge.svg?branch=main
[workflow-url]: https://github.com/castastrophe/agent-skills/actions/workflows/test.yml/badge.svg
[npm-image]: https://img.shields.io/npm/v/@allons-y/agent-skills?logo=npm
[npm-url]: https://www.npmjs.com/package/@allons-y/agent-skills
[conventional-commits-image]: https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg
[conventional-commits-url]: https://conventionalcommits.org/
[coverage-image]: https://img.shields.io/nycrc/castastrophe/envoy
[coverage-url]: https://github.com/castastrophe/envoy/blob/main/.nycrc
