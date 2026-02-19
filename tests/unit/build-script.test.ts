/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Build Script', () => {
  const buildScriptPath = path.join(__dirname, '../../scripts/build.sh');

  it('should exist', () => {
    expect(fs.existsSync(buildScriptPath)).toBe(true);
  });

  it('should be executable', () => {
    const stats = fs.statSync(buildScriptPath);
    // Check if file has execute permission (octal 0o100 for owner execute)
    expect(stats.mode & 0o100).not.toBe(0);
  });

  it('should contain necessary build steps', () => {
    const content = fs.readFileSync(buildScriptPath, 'utf-8');

    // Check for key build steps
    expect(content).toContain('npm ci');
    expect(content).toContain('npm run lint');
    expect(content).toContain('npm run test:unit');
    expect(content).toContain('npm run make');
  });

  it('should have proper shell shebang', () => {
    const content = fs.readFileSync(buildScriptPath, 'utf-8');
    expect(content).toMatch(/^#!\/bin\/bash/);
  });

  it('should exit on errors (set -e)', () => {
    const content = fs.readFileSync(buildScriptPath, 'utf-8');
    expect(content).toContain('set -e');
  });

  it('should detect platform', () => {
    const content = fs.readFileSync(buildScriptPath, 'utf-8');
    expect(content).toContain('uname -s');
    expect(content).toContain('Linux');
    expect(content).toContain('Darwin');
    expect(content).toContain('Windows');
  });

  it('should source NVM if available', () => {
    const content = fs.readFileSync(buildScriptPath, 'utf-8');
    expect(content).toContain('.nvm/nvm.sh');
  });

  it('should check for Node.js', () => {
    const content = fs.readFileSync(buildScriptPath, 'utf-8');
    expect(content).toContain('node --version');
    expect(content).toMatch(/Node\.js not found/);
  });
});
