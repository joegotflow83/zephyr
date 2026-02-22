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
  'build-essential',
  'openssh-client',
];

export function generateDockerfile(config: ImageBuildConfig): string {
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

  // Create ralph group and user using build arg UID/GID
  sections.push(
    'RUN groupadd -g ${HOST_GID} ralph && \\\n    useradd -m -u ${HOST_UID} -g ${HOST_GID} -s /bin/bash ralph'
  );

  // Language install blocks
  for (const lang of config.languages) {
    sections.push('');
    sections.push(getLanguageInstallBlock(lang));
  }

  // Final directives
  sections.push('');
  sections.push('WORKDIR /home/ralph/workspace');
  sections.push('USER ralph');
  sections.push('');

  return sections.join('\n');
}

export function getLanguageInstallBlock(lang: LanguageSelection): string {
  switch (lang.languageId) {
    case 'python': {
      const ver = lang.version;
      return [
        `RUN apt-get update && apt-get install -y software-properties-common && \\`,
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
