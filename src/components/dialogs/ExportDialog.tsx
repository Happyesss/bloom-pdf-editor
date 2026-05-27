'use client';

import { useState } from 'react';
import { X, Download, FileImage, FileText } from 'lucide-react';
import { downloadBlob } from '@/lib/utils';

interface ExportDialogProps {
  open: boolean;
  fileName: string;
  onClose: () => void;
  onExportPdf: () => Promise<Uint8Array>;
}

export default function ExportDialog({ open, fileName, onClose, onExportPdf }: ExportDialogProps) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const baseName = fileName.replace(/\.pdf$/i, '');

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const bytes = await onExportPdf();
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      downloadBlob(blob, `${baseName}-edited.pdf`);
      onClose();
    } catch (e) {
      setError('Export failed. Please try again.');
      console.error(e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-zinc-700">
          <div className="flex items-center gap-2 text-white font-semibold">
            <Download size={18} />
            <span>Export PDF</span>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-lg">
            <FileText size={32} className="text-blue-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-white">{baseName}-edited.pdf</p>
              <p className="text-xs text-zinc-400">All annotations and edits will be baked in</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 text-sm text-zinc-400">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              Text edits & additions embedded
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              Annotations & drawings embedded
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              Signatures embedded
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              Redactions permanently applied
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center justify-center gap-2 w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors disabled:opacity-60"
          >
            <Download size={16} />
            {exporting ? 'Exporting...' : 'Download Edited PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
