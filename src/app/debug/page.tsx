'use client';

import { useState, useRef, useEffect } from 'react';
import type * as Engine from '@/engine';
import { exportToStructure } from '@/engine/docx-export';
import type { ExtractedPage, Block, TextRun } from '@/engine/docx-export/types';

export default function DebugPage() {
  const [loading, setLoading] = useState(false);
  const [pages, setPages] = useState<ExtractedPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const engineRef = useRef<typeof Engine | null>(null);

  useEffect(() => {
    import('@/engine').then(m => {
      engineRef.current = m;
    });
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !engineRef.current) return;

    setLoading(true);
    setError(null);
    setPages(null);

    try {
      const buffer = await file.arrayBuffer();
      const pdfBytes = new Uint8Array(buffer);
      const parsed = await engineRef.current.parsePDF(pdfBytes);
      
      const structure = await exportToStructure(parsed);
      setPages(structure.assembledPages);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto font-sans">
      <h1 className="text-3xl font-bold mb-4">DOCX Extraction Debugger</h1>
      <p className="mb-6 text-gray-600">Upload a PDF to see exactly how the layout engine extracts and splits the text blocks.</p>
      
      <input 
        type="file" 
        accept="application/pdf"
        onChange={handleFileUpload}
        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 mb-8"
      />

      {loading && <div className="text-blue-600 animate-pulse">Processing PDF...</div>}
      {error && <div className="text-red-600 font-medium">Error: {error}</div>}

      {pages && (
        <div className="space-y-12">
          {pages.map((page, i) => (
            <div key={i} className="border border-gray-300 shadow-xl bg-white p-8">
              <h2 className="text-gray-400 text-xs font-mono mb-4 border-b pb-2">PAGE {i + 1}</h2>
              <div className="space-y-4">
                {page.blocks.map((block, j) => (
                  <BlockRenderer key={j} block={block} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RunRenderer({ run }: { run: TextRun }) {
  return (
    <span style={{
      fontWeight: run.bold ? 'bold' : 'normal',
      fontStyle: run.italic ? 'italic' : 'normal',
      color: run.color ? `#${run.color}` : 'inherit',
      fontSize: `${run.fontSize}px`,
      marginRight: '2px' // tiny artificial gap just for debug readability
    }}>
      {run.text}
    </span>
  );
}

function BlockRenderer({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading':
      return (
        <div className="border border-green-200 p-2 bg-green-50/30 rounded">
          <div className="text-[10px] text-green-600 font-mono mb-1 uppercase tracking-wider">HeadingBlock</div>
          <div className="text-center">
            {block.runs.map((r, i) => <RunRenderer key={i} run={r} />)}
          </div>
          {block.accentBorder && (
            <div className="h-1 mt-2" style={{ backgroundColor: `#${block.accentBorder}` }} />
          )}
        </div>
      );
      
    case 'split':
      return (
        <div className="border border-purple-200 p-2 bg-purple-50/30 rounded">
          <div className="text-[10px] text-purple-600 font-mono mb-1 uppercase tracking-wider">SplitBlock (Flex/Tab)</div>
          <div className="flex justify-between items-baseline">
            <div>
              {block.leftRuns.map((r, i) => <RunRenderer key={i} run={r} />)}
            </div>
            <div className="text-right">
              {block.rightRuns.map((r, i) => <RunRenderer key={i} run={r} />)}
            </div>
          </div>
        </div>
      );
      
    case 'list':
      return (
        <div className="border border-orange-200 p-2 bg-orange-50/30 rounded pl-8 relative">
          <div className="text-[10px] text-orange-600 font-mono mb-1 uppercase tracking-wider absolute left-2 top-2">ListBlock</div>
          <div className="mt-4 flex">
            <span className="mr-2 font-bold">{block.marker === 'bullet' ? '•' : '1.'}</span>
            <div>
              {block.runs.map((r, i) => <RunRenderer key={i} run={r} />)}
            </div>
          </div>
        </div>
      );
      
    case 'paragraph':
      return (
        <div className="border border-blue-200 p-2 bg-blue-50/30 rounded">
          <div className="text-[10px] text-blue-600 font-mono mb-1 uppercase tracking-wider">ParagraphBlock ({block.align})</div>
          <div style={{ textAlign: block.align }}>
            {block.runs.map((r, i) => <RunRenderer key={i} run={r} />)}
          </div>
        </div>
      );
      
    case 'table':
      return (
        <div className="border border-indigo-200 p-2 bg-indigo-50/30 rounded overflow-x-auto">
          <div className="text-[10px] text-indigo-600 font-mono mb-1 uppercase tracking-wider">TableBlock</div>
          <table className="w-full text-sm border-collapse">
            <tbody>
              {Array.from({ length: block.rows as number }).map((_, r) => (
                <tr key={r} className="border-b border-indigo-100 last:border-0">
                  {block.cells.filter(c => c.row === r).map((cell, c) => (
                    <td key={c} className="p-2 border-r border-indigo-100 last:border-0 align-top">
                      {cell.runs.map((run, i) => <RunRenderer key={i} run={run} />)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      
    case 'image':
      return (
        <div className="border border-pink-200 p-2 bg-pink-50/30 rounded">
          <div className="text-[10px] text-pink-600 font-mono mb-1 uppercase tracking-wider">ImageBlock</div>
          <div className="text-pink-800 text-sm">Image Data (Base64)</div>
        </div>
      );
      
    case 'hrule':
      return (
        <div className="border border-gray-200 p-2 bg-gray-50/30 rounded">
          <div className="text-[10px] text-gray-600 font-mono mb-1 uppercase tracking-wider">HRuleBlock</div>
          <hr className="my-2 border-gray-400" />
        </div>
      );
      
    default:
      return <div className="text-red-500">Unknown Block</div>;
  }
}
