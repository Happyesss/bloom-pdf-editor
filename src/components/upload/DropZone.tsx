'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, AlertCircle } from 'lucide-react';
import { cn, formatFileSize } from '@/lib/utils';

interface DropZoneProps {
  onFileAccepted: (file: File, bytes: ArrayBuffer) => void;
}

export default function DropZone({ onFileAccepted }: DropZoneProps) {
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      setError(null);
      const file = acceptedFiles[0];
      if (!file) return;
      if (file.type !== 'application/pdf') {
        setError('Only PDF files are supported.');
        return;
      }
      if (file.size > 100 * 1024 * 1024) {
        setError('File size must be under 100 MB.');
        return;
      }
      try {
        const bytes = await file.arrayBuffer();
        onFileAccepted(file, bytes);
      } catch {
        setError('Failed to read file. Please try again.');
      }
    },
    [onFileAccepted]
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: false,
    maxSize: 100 * 1024 * 1024,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        'relative flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-16 cursor-pointer transition-all duration-200',
        isDragActive && !isDragReject ? 'border-blue-500 bg-blue-500/10 scale-[1.02]' : '',
        isDragReject ? 'border-red-500 bg-red-500/10' : '',
        !isDragActive ? 'border-zinc-600 hover:border-zinc-400 hover:bg-zinc-800/40' : ''
      )}
    >
      <input {...getInputProps()} />

      <div className="flex flex-col items-center gap-4 text-center pointer-events-none">
        <div
          className={cn(
            'p-5 rounded-full transition-colors',
            isDragActive ? 'bg-blue-500/20' : 'bg-zinc-800'
          )}
        >
          {isDragActive ? (
            <FileText className="w-10 h-10 text-blue-400" />
          ) : (
            <Upload className="w-10 h-10 text-zinc-400" />
          )}
        </div>

        <div>
          <p className="text-xl font-semibold text-zinc-100">
            {isDragActive ? 'Drop your PDF here' : 'Upload a PDF to start editing'}
          </p>
          <p className="mt-2 text-sm text-zinc-400">
            Drag & drop or <span className="text-blue-400 font-medium">browse files</span>
          </p>
          <p className="mt-1 text-xs text-zinc-500">PDF files up to 100 MB</p>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 mt-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
