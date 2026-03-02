import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Layout } from '../../src/renderer/components/Layout/Layout';

describe('Layout', () => {
  it('renders children in main content area', () => {
    render(
      <Layout>
        <div>Main Content</div>
      </Layout>
    );

    expect(screen.getByText('Main Content')).toBeInTheDocument();
    const mainElement = screen.getByText('Main Content').closest('main');
    expect(mainElement).toBeInTheDocument();
  });

  it('renders header when provided', () => {
    render(
      <Layout header={<div>Header Content</div>}>
        <div>Main Content</div>
      </Layout>
    );

    expect(screen.getByText('Header Content')).toBeInTheDocument();
    const headerElement = screen.getByText('Header Content').closest('header');
    expect(headerElement).toBeInTheDocument();
  });

  it('renders status bar when provided', () => {
    render(
      <Layout statusBar={<div>Status Bar Content</div>}>
        <div>Main Content</div>
      </Layout>
    );

    expect(screen.getByText('Status Bar Content')).toBeInTheDocument();
    const footerElement = screen.getByText('Status Bar Content').closest('footer');
    expect(footerElement).toBeInTheDocument();
  });

  it('renders without header when not provided', () => {
    const { container } = render(
      <Layout>
        <div>Main Content</div>
      </Layout>
    );

    const headers = container.querySelectorAll('header');
    expect(headers).toHaveLength(0);
  });

  it('renders without status bar when not provided', () => {
    const { container } = render(
      <Layout>
        <div>Main Content</div>
      </Layout>
    );

    const footers = container.querySelectorAll('footer');
    expect(footers).toHaveLength(0);
  });

  it('renders all three sections when all props provided', () => {
    render(
      <Layout
        header={<div>Header Content</div>}
        statusBar={<div>Status Bar Content</div>}
      >
        <div>Main Content</div>
      </Layout>
    );

    expect(screen.getByText('Header Content')).toBeInTheDocument();
    expect(screen.getByText('Main Content')).toBeInTheDocument();
    expect(screen.getByText('Status Bar Content')).toBeInTheDocument();
  });

  it('applies proper layout classes', () => {
    const { container } = render(
      <Layout>
        <div>Main Content</div>
      </Layout>
    );

    const rootDiv = container.firstChild;
    expect(rootDiv).toHaveClass('h-screen');
    expect(rootDiv).toHaveClass('flex');
    expect(rootDiv).toHaveClass('flex-col');
    expect(rootDiv).toHaveClass('dark:bg-gray-900');
    expect(rootDiv).toHaveClass('dark:text-gray-100');
  });

  it('main content area has overflow auto', () => {
    render(
      <Layout>
        <div>Main Content</div>
      </Layout>
    );

    const mainElement = screen.getByText('Main Content').closest('main');
    expect(mainElement).toHaveClass('overflow-auto');
  });

  it('main content area is flex-1 to take available space', () => {
    render(
      <Layout>
        <div>Main Content</div>
      </Layout>
    );

    const mainElement = screen.getByText('Main Content').closest('main');
    expect(mainElement).toHaveClass('flex-1');
  });

  it('header is flex-none', () => {
    render(
      <Layout header={<div>Header Content</div>}>
        <div>Main Content</div>
      </Layout>
    );

    const headerElement = screen.getByText('Header Content').closest('header');
    expect(headerElement).toHaveClass('flex-none');
  });

  it('status bar is flex-none', () => {
    render(
      <Layout statusBar={<div>Status Bar Content</div>}>
        <div>Main Content</div>
      </Layout>
    );

    const footerElement = screen.getByText('Status Bar Content').closest('footer');
    expect(footerElement).toHaveClass('flex-none');
  });
});
