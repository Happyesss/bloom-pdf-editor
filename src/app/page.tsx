'use client';

import { useCallback, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { savePdfToStorage } from '@/lib/pdfStorage';
import { FileUp, Loader2 } from 'lucide-react';

export default function Home() {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleFile = useCallback(async (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
      setError('Please select a PDF file.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const buffer = await file.arrayBuffer();
      await savePdfToStorage(buffer, file.name);
      router.push('/editor');
    } catch (e) {
      setError(`Failed to load file: ${e instanceof Error ? e.message : 'Unknown error'}`);
      setIsLoading(false);
    }
  }, [router]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center py-10 px-5 font-sans bg-surface text-app">
      <h1 className="text-4xl font-bold mb-2 text-app tracking-tight">
        PDF Editor
      </h1>
      <p className="text-sm text-app-muted mb-12">
        Pure TypeScript engine — zero dependencies
      </p>

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`w-full max-w-lg min-h-[240px] rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all duration-300 p-8 border-2 border-dashed ${
          isDragging 
            ? 'border-blue-500 bg-blue-500/10 scale-[1.02] shadow-[0_0_30px_rgba(59,130,246,0.15)]' 
            : 'border-app-strong bg-panel/50 hover:bg-panel-elevated hover:border-[var(--text-faint)]'
        }`}
      >
        {isLoading ? (
          <>
            <Loader2 size={48} className="animate-spin text-blue-500 mb-4" />
            <p className="text-sm font-medium text-app-muted animate-pulse">Loading PDF...</p>
          </>
        ) : (
          <>
            <div className={`p-4 rounded-full mb-4 transition-colors duration-300 ${isDragging ? 'bg-blue-500/20 text-blue-400' : 'bg-panel-elevated text-app-muted'}`}>
              <FileUp size={40} />
            </div>
            <p className="text-base font-medium text-app mb-1">
              Drop a PDF here or click to browse
            </p>
            <p className="text-xs text-app-faint font-medium">
              Supports any standard PDF file
            </p>
          </>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={onFileSelect}
        className="hidden"
      />

      {error && (
        <p className="text-red-400 bg-red-400/10 border border-red-400/20 px-4 py-2 rounded-lg text-sm mt-6 max-w-lg text-center font-medium animate-in slide-in-from-bottom-2 fade-in">
          {error}
        </p>
      )}
    </div>
  );
}
