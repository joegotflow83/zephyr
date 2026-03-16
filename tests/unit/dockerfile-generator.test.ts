// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';

import {
  generateDockerfile,
  generateClaudeCodeInstallBlock,
  generateClaudeCodeConfigBlock,
  generateAIToolsInstallBlock,
  getLanguageInstallBlock,
  writeDockerfile,
} from '../../src/services/dockerfile-generator';
import { ImageBuildConfig, LanguageSelection } from '../../src/shared/models';

const { mockWriteFile } = vi.hoisted(() => {
  const mockWriteFile = vi.fn().mockResolvedValue(undefined);
  return { mockWriteFile };
});

vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile,
}));

describe('generateDockerfile', () => {
  it('starts with FROM ubuntu:24.04', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [] };
    const result = generateDockerfile(config);
    expect(result.trimStart()).toMatch(/^FROM ubuntu:24\.04/);
  });

  it('includes ARG HOST_UID=1000', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [] };
    const result = generateDockerfile(config);
    expect(result).toContain('ARG HOST_UID=1000');
  });

  it('includes ARG HOST_GID=1000', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [] };
    const result = generateDockerfile(config);
    expect(result).toContain('ARG HOST_GID=1000');
  });

  it('includes common tools installation (git, curl, wget, vim, jq)', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [] };
    const result = generateDockerfile(config);
    expect(result).toContain('git');
    expect(result).toContain('curl');
    expect(result).toContain('wget');
    expect(result).toContain('vim');
    expect(result).toContain('jq');
  });

  it('includes ca-certificates and build-essential and openssh-client', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [] };
    const result = generateDockerfile(config);
    expect(result).toContain('ca-certificates');
    expect(result).toContain('build-essential');
    expect(result).toContain('openssh-client');
  });

  it('creates ralph group with HOST_GID build arg', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [] };
    const result = generateDockerfile(config);
    expect(result).toContain('groupadd');
    expect(result).toContain('${HOST_GID}');
    expect(result).toContain('ralph');
  });

  it('creates ralph user with HOST_UID and HOST_GID build args', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [] };
    const result = generateDockerfile(config);
    expect(result).toContain('useradd');
    expect(result).toContain('${HOST_UID}');
    expect(result).toContain('${HOST_GID}');
    expect(result).toMatch(/useradd.*ralph/);
  });

  it('sets WORKDIR to /home/ralph/workspace', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [] };
    const result = generateDockerfile(config);
    expect(result).toContain('WORKDIR /home/ralph/workspace');
  });

  it('sets USER to ralph', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [] };
    const result = generateDockerfile(config);
    expect(result).toContain('USER ralph');
  });

  it('WORKDIR and USER appear after language blocks', () => {
    const config: ImageBuildConfig = {
      name: 'test',
      languages: [{ languageId: 'python', version: '3.12' }],
    };
    const result = generateDockerfile(config);
    const workdirIdx = result.indexOf('WORKDIR /home/ralph/workspace');
    const pythonIdx = result.indexOf('python3.12');
    expect(pythonIdx).toBeGreaterThan(0);
    expect(workdirIdx).toBeGreaterThan(pythonIdx);
  });

  it('empty languages produces base-only Dockerfile without language-specific blocks', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [] };
    const result = generateDockerfile(config);
    expect(result).not.toContain('deadsnakes');
    expect(result).not.toContain('rustup.rs');
    expect(result).not.toContain('golang');
    // Node may be installed for Claude Code even when no language is selected
  });

  it('includes claude code installation by default', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [] };
    const result = generateDockerfile(config);
    expect(result).toContain('@anthropic-ai/claude-code');
  });

  it('installs Node 22 for claude code when nodejs not selected as language', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [] };
    const result = generateDockerfile(config);
    expect(result).toContain('nodesource');
    expect(result).toContain('setup_22.x');
  });

  it('skips standalone node install for claude code when nodejs already selected', () => {
    const config: ImageBuildConfig = {
      name: 'test',
      languages: [{ languageId: 'nodejs', version: '20' }],
    };
    const result = generateDockerfile(config);
    // nodesource appears once (for the nodejs language block), not twice
    expect(result.split('nodesource').length - 1).toBe(1);
    expect(result).toContain('@anthropic-ai/claude-code');
  });

  it('omits claude code when installClaudeCode is false', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [], installClaudeCode: false };
    const result = generateDockerfile(config);
    expect(result).not.toContain('@anthropic-ai/claude-code');
    expect(result).not.toContain('setup_22.x');
  });

  it('pre-configures claude settings file as ralph user', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [] };
    const result = generateDockerfile(config);
    expect(result).toContain('/home/ralph/.claude/settings.json');
    expect(result).toContain('autoUpdaterStatus');
  });

  it('claude code config block appears after USER ralph', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [] };
    const result = generateDockerfile(config);
    const userRalphIdx = result.indexOf('USER ralph');
    const settingsIdx = result.indexOf('/home/ralph/.claude/settings.json');
    expect(userRalphIdx).toBeGreaterThan(0);
    expect(settingsIdx).toBeGreaterThan(userRalphIdx);
  });

  it('includes python language block when python is in config', () => {
    const config: ImageBuildConfig = {
      name: 'test',
      languages: [{ languageId: 'python', version: '3.11' }],
    };
    const result = generateDockerfile(config);
    expect(result).toContain('deadsnakes');
    expect(result).toContain('python3.11');
  });

  it('includes nodejs language block when nodejs is in config', () => {
    const config: ImageBuildConfig = {
      name: 'test',
      languages: [{ languageId: 'nodejs', version: '20' }],
    };
    const result = generateDockerfile(config);
    expect(result).toContain('nodesource');
    expect(result).toContain('setup_20.x');
  });

  it('includes rust language block when rust is in config', () => {
    const config: ImageBuildConfig = {
      name: 'test',
      languages: [{ languageId: 'rust', version: 'stable' }],
    };
    const result = generateDockerfile(config);
    expect(result).toContain('rustup.rs');
  });

  it('includes go language block when go is in config', () => {
    const config: ImageBuildConfig = {
      name: 'test',
      languages: [{ languageId: 'go', version: '1.23' }],
    };
    const result = generateDockerfile(config);
    expect(result).toContain('go1.23');
  });

  it('includes all language blocks when multiple languages specified', () => {
    const config: ImageBuildConfig = {
      name: 'test',
      languages: [
        { languageId: 'python', version: '3.11' },
        { languageId: 'nodejs', version: '20' },
        { languageId: 'rust', version: 'stable' },
        { languageId: 'go', version: '1.23' },
      ],
    };
    const result = generateDockerfile(config);
    expect(result).toContain('deadsnakes');
    expect(result).toContain('nodesource');
    expect(result).toContain('rustup.rs');
    expect(result).toContain('go1.23');
  });

  it('language blocks appear in the order specified', () => {
    const config: ImageBuildConfig = {
      name: 'test',
      languages: [
        { languageId: 'nodejs', version: '20' },
        { languageId: 'python', version: '3.12' },
      ],
    };
    const result = generateDockerfile(config);
    const nodeIdx = result.indexOf('nodesource');
    const pythonIdx = result.indexOf('python3.12');
    expect(nodeIdx).toBeLessThan(pythonIdx);
  });
});

describe('getLanguageInstallBlock', () => {
  it('python block includes deadsnakes PPA', () => {
    const result = getLanguageInstallBlock({ languageId: 'python', version: '3.11' });
    expect(result).toContain('deadsnakes');
  });

  it('python block installs correct version packages', () => {
    const result = getLanguageInstallBlock({ languageId: 'python', version: '3.10' });
    expect(result).toContain('python3.10');
    expect(result).toContain('python3.10-venv');
  });

  it('python block installs pip', () => {
    // 3.12 uses Ubuntu 24.04 default repos with python3-pip
    const result312 = getLanguageInstallBlock({ languageId: 'python', version: '3.12' });
    expect(result312).toContain('python3-pip');
    expect(result312).toContain('python3.12');
    // older versions use get-pip.py via deadsnakes PPA
    const result311 = getLanguageInstallBlock({ languageId: 'python', version: '3.11' });
    expect(result311).toContain('get-pip.py');
  });

  it('nodejs block includes nodesource setup script for specified version', () => {
    const result = getLanguageInstallBlock({ languageId: 'nodejs', version: '18' });
    expect(result).toContain('setup_18.x');
  });

  it('nodejs block installs nodejs package', () => {
    const result = getLanguageInstallBlock({ languageId: 'nodejs', version: '22' });
    expect(result).toContain('nodejs');
  });

  it('rust block includes rustup installer URL', () => {
    const result = getLanguageInstallBlock({ languageId: 'rust', version: 'stable' });
    expect(result).toContain('sh.rustup.rs');
  });

  it('rust block sets RUSTUP_HOME and CARGO_HOME environment variables', () => {
    const result = getLanguageInstallBlock({ languageId: 'rust', version: 'stable' });
    expect(result).toContain('RUSTUP_HOME');
    expect(result).toContain('CARGO_HOME');
  });

  it('rust block sets PATH to include cargo bin', () => {
    const result = getLanguageInstallBlock({ languageId: 'rust', version: 'stable' });
    expect(result).toContain('/usr/local/cargo/bin');
  });

  it('go block downloads correct version from go.dev', () => {
    const result = getLanguageInstallBlock({ languageId: 'go', version: '1.22' });
    expect(result).toContain('go1.22');
    expect(result).toContain('dl.google.com');
  });

  it('go block sets GOPATH and PATH', () => {
    const result = getLanguageInstallBlock({ languageId: 'go', version: '1.23' });
    expect(result).toContain('GOPATH');
    expect(result).toContain('/usr/local/go/bin');
  });

  it('unknown language returns comment', () => {
    const result = getLanguageInstallBlock({ languageId: 'ruby', version: '3.0' });
    expect(result).toContain('# Unknown language');
    expect(result).toContain('ruby');
  });
});

describe('generateClaudeCodeInstallBlock', () => {
  it('includes npm install for @anthropic-ai/claude-code', () => {
    const result = generateClaudeCodeInstallBlock(true);
    expect(result).toContain('@anthropic-ai/claude-code');
    expect(result).toContain('npm install -g');
  });

  it('does not add nodesource when nodejs is already available', () => {
    const result = generateClaudeCodeInstallBlock(true);
    expect(result).not.toContain('nodesource');
  });

  it('adds Node 22 via nodesource when nodejs is not available', () => {
    const result = generateClaudeCodeInstallBlock(false);
    expect(result).toContain('nodesource');
    expect(result).toContain('setup_22.x');
    expect(result).toContain('@anthropic-ai/claude-code');
  });
});

describe('generateAIToolsInstallBlock', () => {
  it('downloads and installs Amazon Q Developer CLI', () => {
    const result = generateAIToolsInstallBlock();
    expect(result).toContain('q-x86_64-linux.zip');
    expect(result).toContain('q/install.sh');
  });

  it('downloads and installs Kiro CLI', () => {
    const result = generateAIToolsInstallBlock();
    expect(result).toContain('kirocli-x86_64-linux.zip');
    expect(result).toContain('kirocli/install.sh');
  });

  it('cleans up temp files after install', () => {
    const result = generateAIToolsInstallBlock();
    expect(result).toContain('rm -rf');
  });
});

describe('generateDockerfile AI tools', () => {
  it('includes Q Developer CLI install', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [] };
    const result = generateDockerfile(config);
    expect(result).toContain('q-x86_64-linux.zip');
  });

  it('includes Kiro CLI install', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [] };
    const result = generateDockerfile(config);
    expect(result).toContain('kirocli-x86_64-linux.zip');
  });

  it('AI tools install appears after USER ralph', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [] };
    const result = generateDockerfile(config);
    const userRalphIdx = result.indexOf('USER ralph');
    const qIdx = result.indexOf('q-x86_64-linux.zip');
    expect(qIdx).toBeGreaterThan(userRalphIdx);
  });

  it('includes unzip in common tools', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [] };
    const result = generateDockerfile(config);
    expect(result).toContain('unzip');
  });

  it('sets ~/.local/bin in PATH', () => {
    const config: ImageBuildConfig = { name: 'test', languages: [] };
    const result = generateDockerfile(config);
    expect(result).toContain('/home/ralph/.local/bin');
  });
});

describe('generateClaudeCodeConfigBlock', () => {
  it('creates the .claude directory', () => {
    const result = generateClaudeCodeConfigBlock();
    expect(result).toContain('mkdir -p /home/ralph/.claude');
  });

  it('writes settings.json with autoUpdaterStatus disabled', () => {
    const result = generateClaudeCodeConfigBlock();
    expect(result).toContain('settings.json');
    expect(result).toContain('autoUpdaterStatus');
    expect(result).toContain('disabled');
  });
});

describe('writeDockerfile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('writes Dockerfile to the specified directory', async () => {
    const content = 'FROM ubuntu:24.04\n';
    await writeDockerfile('/tmp/mybuild', content);
    expect(mockWriteFile).toHaveBeenCalledWith(path.join('/tmp/mybuild', 'Dockerfile'), content, 'utf-8');
  });

  it('returns the path to the written Dockerfile', async () => {
    const filePath = await writeDockerfile('/tmp/mybuild', 'FROM ubuntu:24.04\n');
    expect(filePath).toBe(path.join('/tmp/mybuild', 'Dockerfile'));
  });

  it('uses path.join so path separators are correct', async () => {
    const filePath = await writeDockerfile('/some/dir', 'FROM ubuntu:24.04\n');
    expect(filePath).toMatch(/Dockerfile$/);
    expect(filePath).toContain('some');
    expect(filePath).toContain('dir');
  });

  it('propagates errors from fs.writeFile', async () => {
    mockWriteFile.mockRejectedValue(new Error('EACCES: permission denied'));
    await expect(writeDockerfile('/restricted', 'content')).rejects.toThrow('EACCES');
  });
});
