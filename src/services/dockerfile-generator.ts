import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import { ImageBuildConfig, LanguageSelection } from '../shared/models';

const COMMON_TOOLS = [
  'git',
  'curl',
  'wget',
  'vim',
  'jq',
  'ca-certificates',
  'bc',
  'build-essential',
  'openssh-client',
  // Playwright runtime dependencies
  'libglib2.0-0',
  'libnspr4',
  'libnspr4-dev',
  'libnss3',
  'libatk1.0-0',
  'libatk-bridge2.0-0',
  'libxcomposite1',
  'libxdamage1',
  'libxfixes3',
];

export function generateDockerfile(config: ImageBuildConfig): string {
  const installClaudeCode = config.installClaudeCode !== false;
  const hasNodejs = config.languages.some((l) => l.languageId === 'nodejs');
  const sections: string[] = [];

  // Base image
  sections.push('FROM ubuntu:24.04');
  sections.push('');

  // Build args for UID/GID mapping
  sections.push('ARG HOST_UID=1000');
  sections.push('ARG HOST_GID=1000');
  sections.push('');

  // Common tools
  sections.push(
    `RUN apt-get update && apt-get install -y \\\n    ${COMMON_TOOLS.join(' ')} \\\n    && rm -rf /var/lib/apt/lists/*`
  );
  sections.push('');

  // Create ralph group and user using build arg UID/GID.
  // Generically remove any existing user/group occupying HOST_UID/HOST_GID
  // (e.g. ubuntu:24.04 ships with an `ubuntu` user at UID/GID 1000) to
  // prevent groupadd/useradd exit code 4 ("GID/UID already in use").
  sections.push(
    'RUN (getent passwd "${HOST_UID}" | cut -d: -f1 | xargs -r userdel -r) 2>/dev/null || true && \\\n' +
    '    (getent group "${HOST_GID}" | cut -d: -f1 | xargs -r groupdel) 2>/dev/null || true && \\\n' +
    '    groupadd -g ${HOST_GID} ralph && \\\n' +
    '    useradd -m -u ${HOST_UID} -g ${HOST_GID} -s /bin/bash ralph'
  );

  // Language install blocks
  for (const lang of config.languages) {
    sections.push('');
    sections.push(getLanguageInstallBlock(lang));
  }

  // Claude Code installation (as root, before USER switch so npm -g works).
  // If Node.js was not selected as a language, install Node 22 LTS first.
  if (installClaudeCode) {
    sections.push('');
    sections.push(generateClaudeCodeInstallBlock(hasNodejs));
  }

  // Final directives
  sections.push('');
  sections.push('WORKDIR /home/ralph/workspace');
  sections.push('USER ralph');
  sections.push('');

  // Pre-configure Claude Code settings as the ralph user (cached layer).
  if (installClaudeCode) {
    sections.push(generateClaudeCodeConfigBlock());
    sections.push('');
  }

  // Unique label per build to bust Docker's BuildKit cache at this point.
  // Without it, BuildKit can return a fully-cached image whose CMD is still
  // the ubuntu base default (/bin/bash) rather than our sleep infinity.
  // All expensive RUN layers above remain cached; only the final metadata
  // steps are re-evaluated.
  sections.push(`LABEL zephyr.build_id="${crypto.randomUUID()}"`);
  sections.push('');
  // Keep the container alive so exec commands (e.g. Claude Code runs) can be
  // dispatched into it without the container exiting immediately.
  sections.push('CMD ["sleep", "infinity"]');
  sections.push('');

  return sections.join('\n');
}

/**
 * Generates the Dockerfile RUN block(s) that install Claude Code globally.
 *
 * @param hasNodejs - Whether Node.js was already selected as a language (and
 *   will therefore be available on PATH before this block executes).
 */
export function generateClaudeCodeInstallBlock(hasNodejs: boolean): string {
  const parts: string[] = [];
  if (!hasNodejs) {
    // Node.js not selected as a language; install Node 22 LTS via NodeSource
    // so that npm is available for the Claude Code global install below.
    parts.push(
      'RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \\\n' +
      '    apt-get install -y nodejs && \\\n' +
      '    rm -rf /var/lib/apt/lists/*'
    );
    parts.push('');
  }
  parts.push('RUN npm install -g @anthropic-ai/claude-code');
  return parts.join('\n');
}

/**
 * Generates the Dockerfile RUN block that writes a minimal Claude Code
 * settings file as the ralph user.  Must be emitted after `USER ralph`.
 */
export function generateClaudeCodeConfigBlock(): string {
  return [
    'RUN mkdir -p /home/ralph/.claude && \\',
    `    printf '{"autoUpdaterStatus":"disabled"}\\n' > /home/ralph/.claude/settings.json`,
  ].join('\n');
}

export function getLanguageInstallBlock(lang: LanguageSelection): string {
  switch (lang.languageId) {
    case 'python': {
      const ver = lang.version;
      // Python 3.12 ships in Ubuntu 24.04's default repos; no PPA needed.
      // Older versions require the deadsnakes PPA.
      if (ver === '3.12') {
        return [
          `RUN apt-get update && apt-get install -y python3.12 python3.12-venv python3.12-dev python3-pip && \\`,
          `    rm -rf /var/lib/apt/lists/*`,
        ].join('\n');
      }
      return [
        `RUN apt-get update && apt-get install -y software-properties-common gnupg && \\`,
        `    add-apt-repository ppa:deadsnakes/ppa && \\`,
        `    apt-get update && apt-get install -y python${ver} python${ver}-venv python${ver}-dev && \\`,
        `    curl -sS https://bootstrap.pypa.io/get-pip.py | python${ver} && \\`,
        `    rm -rf /var/lib/apt/lists/*`,
      ].join('\n');
    }

    case 'nodejs': {
      const ver = lang.version;
      return [
        `RUN curl -fsSL https://deb.nodesource.com/setup_${ver}.x | bash - && \\`,
        `    apt-get install -y nodejs && \\`,
        `    rm -rf /var/lib/apt/lists/*`,
      ].join('\n');
    }

    case 'rust': {
      return [
        `ENV RUSTUP_HOME=/usr/local/rustup \\`,
        `    CARGO_HOME=/usr/local/cargo \\`,
        `    PATH=/usr/local/cargo/bin:$PATH`,
        `RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path`,
        `RUN chmod -R a+w /usr/local/rustup /usr/local/cargo`,
      ].join('\n');
    }

    case 'go': {
      const ver = lang.version;
      return [
        `RUN curl -fsSL https://dl.google.com/go/go${ver}.linux-amd64.tar.gz | tar -C /usr/local -xzf -`,
        `ENV GOPATH=/home/ralph/go \\`,
        `    PATH=/usr/local/go/bin:/home/ralph/go/bin:$PATH`,
      ].join('\n');
    }

    default:
      return `# Unknown language: ${lang.languageId}`;
  }
}

export async function writeDockerfile(dir: string, content: string): Promise<string> {
  const filePath = path.join(dir, 'Dockerfile');
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}
