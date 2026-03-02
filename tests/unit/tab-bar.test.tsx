import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabBar, Tab, TabId } from '../../src/renderer/components/TabBar/TabBar';

describe('TabBar', () => {
  const mockTabs: Tab[] = [
    { id: 'projects', label: 'Projects', icon: '📁' },
    { id: 'loops', label: 'Running Loops', icon: '🔄', badge: 3 },
    { id: 'terminal', label: 'Terminal', icon: '💻' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ];

  it('renders all tabs', () => {
    const onTabChange = vi.fn();
    render(<TabBar tabs={mockTabs} activeTab="projects" onTabChange={onTabChange} />);

    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('Running Loops')).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders tab icons', () => {
    const onTabChange = vi.fn();
    render(<TabBar tabs={mockTabs} activeTab="projects" onTabChange={onTabChange} />);

    expect(screen.getByText('📁')).toBeInTheDocument();
    expect(screen.getByText('🔄')).toBeInTheDocument();
    expect(screen.getByText('💻')).toBeInTheDocument();
    expect(screen.getByText('⚙️')).toBeInTheDocument();
  });

  it('highlights active tab', () => {
    const onTabChange = vi.fn();
    const { container } = render(
      <TabBar tabs={mockTabs} activeTab="loops" onTabChange={onTabChange} />
    );

    const loopsButton = screen.getByText('Running Loops').closest('button');
    expect(loopsButton).toHaveClass('text-blue-500');
    expect(loopsButton).toHaveClass('border-b-2');
    expect(loopsButton).toHaveClass('border-blue-500');
  });

  it('calls onTabChange when tab is clicked', () => {
    const onTabChange = vi.fn();
    render(<TabBar tabs={mockTabs} activeTab="projects" onTabChange={onTabChange} />);

    const terminalButton = screen.getByText('Terminal').closest('button');
    fireEvent.click(terminalButton!);

    expect(onTabChange).toHaveBeenCalledWith('terminal');
    expect(onTabChange).toHaveBeenCalledTimes(1);
  });

  it('renders badge when provided', () => {
    const onTabChange = vi.fn();
    render(<TabBar tabs={mockTabs} activeTab="projects" onTabChange={onTabChange} />);

    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('does not render badge when count is zero', () => {
    const tabsWithZeroBadge: Tab[] = [
      { id: 'projects', label: 'Projects', icon: '📁', badge: 0 },
    ];
    const onTabChange = vi.fn();
    render(<TabBar tabs={tabsWithZeroBadge} activeTab="projects" onTabChange={onTabChange} />);

    const badge = screen.queryByText('0');
    expect(badge).not.toBeInTheDocument();
  });

  it('does not render badge when not provided', () => {
    const tabsWithoutBadge: Tab[] = [
      { id: 'projects', label: 'Projects', icon: '📁' },
    ];
    const onTabChange = vi.fn();
    const { container } = render(
      <TabBar tabs={tabsWithoutBadge} activeTab="projects" onTabChange={onTabChange} />
    );

    const badges = container.querySelectorAll('.bg-blue-600');
    expect(badges).toHaveLength(0);
  });

  it('applies aria-current attribute to active tab', () => {
    const onTabChange = vi.fn();
    render(<TabBar tabs={mockTabs} activeTab="settings" onTabChange={onTabChange} />);

    const settingsButton = screen.getByText('Settings').closest('button');
    expect(settingsButton).toHaveAttribute('aria-current', 'page');

    const projectsButton = screen.getByText('Projects').closest('button');
    expect(projectsButton).not.toHaveAttribute('aria-current');
  });

  it('inactive tabs have hover styles', () => {
    const onTabChange = vi.fn();
    render(<TabBar tabs={mockTabs} activeTab="projects" onTabChange={onTabChange} />);

    const loopsButton = screen.getByText('Running Loops').closest('button');
    expect(loopsButton).toHaveClass('dark:hover:text-gray-200');
    expect(loopsButton).toHaveClass('dark:hover:bg-gray-800');
  });
});
