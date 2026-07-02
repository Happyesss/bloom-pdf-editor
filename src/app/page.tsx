'use client';

import { useCallback, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { savePdfToStorage } from '@/lib/pdfStorage';

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
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <h1 style={{
        fontSize: 32,
        fontWeight: 700,
        marginBottom: 8,
        color: '#f5f5f7',
      }}>
        PDF Editor
      </h1>
      <p style={{
        fontSize: 14,
        color: '#888',
        marginBottom: 40,
      }}>
        Pure TypeScript engine — zero dependencies
      </p>

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => fileInputRef.current?.click()}
        style={{
          width: '100%',
          maxWidth: 480,
          minHeight: 220,
          border: `2px dashed ${isDragging ? '#2997ff' : '#333'}`,
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          background: isDragging ? 'rgba(41, 151, 255, 0.05)' : 'rgba(255,255,255,0.02)',
          transition: 'all 0.2s ease',
          padding: 32,
        }}
      >
        {isLoading ? (
          <>
            <div style={{
              width: 40,
              height: 40,
              border: '3px solid #333',
              borderTopColor: '#2997ff',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              marginBottom: 16,
            }} />
            <p style={{ color: '#aaa', fontSize: 14 }}>Loading PDF...</p>
          </>
        ) : (
          <>
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke={isDragging ? '#2997ff' : '#666'}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginBottom: 16 }}
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="12" y2="12" />
              <line x1="15" y1="15" x2="12" y2="12" />
            </svg>
            <p style={{ color: '#ccc', fontSize: 15, marginBottom: 4 }}>
              Drop a PDF here or click to browse
            </p>
            <p style={{ color: '#666', fontSize: 12 }}>
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
        style={{ display: 'none' }}
      />

      {error && (
        <p style={{
          color: '#ff453a',
          fontSize: 13,
          marginTop: 16,
          maxWidth: 480,
          textAlign: 'center',
        }}>
          {error}
        </p>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
