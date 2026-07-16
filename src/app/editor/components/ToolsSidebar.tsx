import React from 'react';
import { TOOLS, type EditorTool } from '../types';

interface ToolsSidebarProps {
  activeTool: EditorTool;
  setActiveTool: (tool: EditorTool) => void;
  highlightColor: string;
}

export function ToolsSidebar({
  activeTool,
  setActiveTool,
  highlightColor
}: ToolsSidebarProps) {
  return (
    <aside className="w-16 bg-panel/95 backdrop-blur-md border-r border-app flex flex-col items-center pt-4 pb-4 gap-2 shrink-0 z-10 shadow-[4px_0_24px_rgba(0,0,0,0.08)]">
      <div className="flex-1 flex flex-col gap-2 w-full px-2">
        {TOOLS.map((tool) => {
          const isActive = activeTool === tool.id;
          const isHighlight = tool.id === 'highlight';
          const activeColor = isHighlight ? highlightColor : '#3b82f6';
          
          return (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              title={`${tool.label} (${tool.shortcut})`}
              className="w-full aspect-square flex flex-col items-center justify-center gap-1 rounded-xl transition-all duration-200 group relative"
              style={{
                backgroundColor: isActive ? (isHighlight ? `${highlightColor}25` : 'rgba(59, 130, 246, 0.15)') : 'transparent',
                color: isActive ? activeColor : 'var(--text-muted)',
              }}
            >
              <div className={`transition-transform duration-200 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}>
                <tool.icon size={18} />
              </div>
              {isActive && (
                <div 
                  className="absolute left-0 top-1/4 bottom-1/4 w-1 rounded-r-full"
                  style={{ backgroundColor: activeColor }}
                />
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
