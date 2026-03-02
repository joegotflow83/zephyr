import React from 'react';

export interface LayoutProps {
  children: React.ReactNode;
  header?: React.ReactNode;
  statusBar?: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children, header, statusBar }) => {
  return (
    <div className="h-screen flex flex-col bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      {header && <header className="flex-none">{header}</header>}
      <main className="flex-1 overflow-auto">{children}</main>
      {statusBar && <footer className="flex-none border-t border-gray-200 dark:border-gray-700">{statusBar}</footer>}
    </div>
  );
};
