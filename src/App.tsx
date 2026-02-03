import React from "react";

export const App: React.FC = () => {
  return (
    <div className="flex h-full">
      <aside className="w-64 border-r border-border bg-card p-4">
        <h1 className="text-lg font-bold text-foreground">PeriCode</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Multi-agent command center
        </p>
      </aside>
      <main className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-foreground">
            Welcome to PeriCode
          </h2>
          <p className="mt-2 text-muted-foreground">
            Open a project to get started
          </p>
        </div>
      </main>
    </div>
  );
};
