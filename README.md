# Gravity-CLI

[![Gravity-CLI CI](https://github.com/Fs9822d/gravity-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Fs9822d/gravity-cli/actions/workflows/ci.yml)
[![Gravity-CLI E2E (Chained)](https://github.com/Fs9822d/gravity-cli/actions/workflows/chained_e2e.yml/badge.svg)](https://github.com/Fs9822d/gravity-cli/actions/workflows/chained_e2e.yml)
[![License](https://img.shields.io/github/license/Fs9822d/gravity-cli)](https://github.com/Fs9822d/gravity-cli/blob/main/LICENSE)

Gravity-CLI (`gravity`) is a modern AI terminal agent interface powered by
Google Antigravity (`agy` ACP backend). It brings powerful multi-agent coding,
terminal automation, and ACP integration directly into your developer workflows.

## 📦 Installation

### Quick Install

Run directly from source or install locally:

```bash
# Clone the repository
git clone https://github.com/Fs9822d/gravity-cli.git
cd gravity-cli

# Install dependencies and build
npm install
npm run build

# Run Gravity-CLI
npm start

# Or link globally to run 'gravity' directly anywhere
npm link ./packages/cli
```

## 📋 Key Features

### Code Understanding & Generation

- Query and edit large codebases
- Generate new apps from PDFs, images, or sketches using multimodal capabilities
- Debug issues and troubleshoot with natural language

### Automation & Integration

- Automate operational tasks like querying pull requests or handling complex
  rebases
- Use MCP servers to connect new capabilities, including
  [media generation with Imagen, Veo or Lyria](https://github.com/GoogleCloudPlatform/vertex-ai-creative-studio/tree/main/experiments/mcp-genmedia)
- Run non-interactively in scripts for workflow automation

## 🔐 Authentication Options

Choose the authentication method that best fits your needs:

### Option 1: Sign in with Google (OAuth login using your Google Account)

#### When using a paid Code Assist License from your organization, remember to set the Google Cloud Project

```bash
# Set your Google Cloud Project
export GOOGLE_CLOUD_PROJECT="YOUR_PROJECT_ID"
gravity
```

### Option 2: Gemini API Key

**✨ Best for:** Developers who need specific model control or paid tier access

**Benefits:**

- **Model selection**: Choose specific Gemini models
- **Usage-based billing**: Upgrade for higher limits when needed

```bash
# Get your key from https://aistudio.google.com/apikey
export GEMINI_API_KEY="YOUR_API_KEY"
gravity
```

### Option 3: Vertex AI

**✨ Best for:** Enterprise teams and production workloads

**Benefits:**

- **Enterprise features**: Advanced security and compliance
- **Scalable**: Higher rate limits with billing account
- **Integration**: Works with existing Google Cloud infrastructure

```bash
# Get your key from Google Cloud Console
export GOOGLE_API_KEY="YOUR_API_KEY"
export GOOGLE_GENAI_USE_VERTEXAI=true
gravity
```

For Google Workspace accounts and other authentication methods, see the
[authentication guide](https://www.geminicli.com/docs/get-started/authentication).

## 🚀 Getting Started

### Basic Usage

#### Start in current directory

```bash
gravity
```

#### Include multiple directories

```bash
gravity --include-directories ../lib,../docs
```

#### Use specific model

```bash
gravity -m gemini-2.5-flash
```

#### Non-interactive mode for scripts

Get a simple text response:

```bash
gravity -p "Explain the architecture of this codebase"
```

For more advanced scripting, including how to parse JSON and handle errors, use
the `--output-format json` flag to get structured output:

```bash
gravity -p "Explain the architecture of this codebase" --output-format json
```

For real-time event streaming (useful for monitoring long-running operations),
use `--output-format stream-json` to get newline-delimited JSON events:

```bash
gravity -p "Run tests and deploy" --output-format stream-json
```

### Quick Examples

#### Start a new project

```bash
cd new-project/
gravity
> Write me a Discord bot that answers questions using a FAQ.md file I will provide
```

#### Analyze existing code

```bash
git clone https://github.com/Fs9822d/gravity-cli
cd gravity-cli
gravity
> Give me a summary of all of the changes that went in yesterday
```

## 📚 Documentation

### Getting Started

- [**Quickstart Guide**](https://www.geminicli.com/docs/get-started) - Get up
  and running quickly.
- [**Authentication Setup**](https://www.geminicli.com/docs/get-started/authentication) -
  Detailed auth configuration.
- [**Configuration Guide**](https://www.geminicli.com/docs/reference/configuration) -
  Settings and customization.
- [**Keyboard Shortcuts**](https://www.geminicli.com/docs/reference/keyboard-shortcuts) -
  Productivity tips.

### Core Features

- [**Commands Reference**](https://www.geminicli.com/docs/reference/commands) -
  All slash commands (`/help`, `/chat`, etc).
- [**Custom Commands**](https://www.geminicli.com/docs/cli/custom-commands) -
  Create your own reusable commands.
- [**Context Files (GEMINI.md)**](https://www.geminicli.com/docs/cli/gemini-md) -
  Provide persistent context to Gravity-CLI.
- [**Checkpointing**](https://www.geminicli.com/docs/cli/checkpointing) - Save
  and resume conversations.
- [**Token Caching**](https://www.geminicli.com/docs/cli/token-caching) -
  Optimize token usage.

### Tools & Extensions

- [**Built-in Tools Overview**](https://www.geminicli.com/docs/reference/tools)
  - [File System Operations](https://www.geminicli.com/docs/tools/file-system)
  - [Shell Commands](https://www.geminicli.com/docs/tools/shell)
  - [Web Fetch & Search](https://www.geminicli.com/docs/tools/web-fetch)
- [**MCP Server Integration**](https://www.geminicli.com/docs/tools/mcp-server) -
  Extend with custom tools.
- [**Custom Extensions**](https://geminicli.com/docs/extensions/writing-extensions) -
  Build and share your own commands.

### Advanced Topics

- [**Headless Mode (Scripting)**](https://www.geminicli.com/docs/cli/headless) -
  Use Gravity-CLI in automated workflows.
- [**IDE Integration**](https://www.geminicli.com/docs/ide-integration) - VS
  Code companion.
- [**Sandboxing & Security**](https://www.geminicli.com/docs/cli/sandbox) - Safe
  execution environments.
- [**Trusted Folders**](https://www.geminicli.com/docs/cli/trusted-folders) -
  Control execution policies by folder.
- [**Enterprise Guide**](https://www.geminicli.com/docs/cli/enterprise) - Deploy
  and manage in a corporate environment.
- [**Telemetry & Monitoring**](https://www.geminicli.com/docs/cli/telemetry) -
  Usage tracking.
- [**Tools reference**](https://www.geminicli.com/docs/reference/tools) -
  Built-in tools overview.
- [**Local development**](https://www.geminicli.com/docs/local-development) -
  Local development tooling.

### Troubleshooting & Support

- [**Troubleshooting Guide**](https://www.geminicli.com/docs/resources/troubleshooting) -
  Common issues and solutions.
- [**FAQ**](https://www.geminicli.com/docs/resources/faq) - Frequently asked
  questions.
- Use `/bug` command to report issues directly from the CLI.

### Using MCP Servers

Configure MCP servers in `~/.gemini/settings.json` to extend Gravity-CLI with
custom tools:

```text
> @github List my open pull requests
> @slack Send a summary of today's commits to #dev channel
> @database Run a query to find inactive users
```

See the
[MCP Server Integration guide](https://www.geminicli.com/docs/tools/mcp-server)
for setup instructions.

## 🤝 Contributing

We welcome contributions! Gravity-CLI is fully open source (Apache 2.0), and we
encourage the community to:

- Report bugs and suggest features.
- Improve documentation.
- Submit code improvements.
- Share your MCP servers and extensions.

See our [Contributing Guide](./CONTRIBUTING.md) for development setup, coding
standards, and how to submit pull requests.

Check our [Official Roadmap](./ROADMAP.md) for planned features and priorities.

## 📖 Resources

- **[Free Course](https://learn.deeplearning.ai/courses/gemini-cli-code-and-create-with-an-open-source-agent/information)** -
  Learn the basics.
- **[Official Roadmap](./ROADMAP.md)** - See what's coming next.
- **[Changelog](https://www.geminicli.com/docs/changelogs)** - See recent
  notable updates.
- **[GitHub Issues](https://github.com/Fs9822d/gravity-cli/issues)** - Report
  bugs or request features.
- **[Security Advisories](https://github.com/Fs9822d/gravity-cli/security/advisories)** -
  Security updates.

### Uninstall

See the [Uninstall Guide](https://www.geminicli.com/docs/resources/uninstall)
for removal instructions.

## 📄 Legal

- **License**: [Apache License 2.0](LICENSE)
- **Terms of Service**:
  [Terms & Privacy](https://www.geminicli.com/docs/resources/tos-privacy)
- **Security**: [Security Policy](SECURITY.md)

<p align="left">
 <a href="https://www.star-history.com/Fs9822d/gravity-cli">
  <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/badge?repo=Fs9822d/gravity-cli&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/badge?repo=Fs9822d/gravity-cli&theme=light" />
   <img alt="Star History Rank" src="https://api.star-history.com/badge?repo=Fs9822d/gravity-cli" />
  </picture>
 </a>
</p>

---

<p align="center">
  Built with ❤️ by Google and the open source community
</p>
