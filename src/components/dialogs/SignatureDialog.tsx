'use client';

import { useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { X, RotateCcw, Check, Type, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SignatureDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (dataUrl: string) => void;
}

type Tab = 'draw' | 'type' | 'upload';

const SIGNATURE_FONTS = [
  { label: 'Dancing Script', value: 'cursive' },
  { label: 'Caveat', value: '"Caveat", cursive' },
  { label: 'Print', value: 'Arial' },
];

export default function SignatureDialog({ open, onClose, onApply }: SignatureDialogProps) {
  const sigRef = useRef<SignatureCanvas>(null);
  const [tab, setTab] = useState<Tab>('draw');
  const [typedName, setTypedName] = useState('');
  const [signatureFont, setSignatureFont] = useState(SIGNATURE_FONTS[0].value);
  const [color, setColor] = useState('#000000');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const handleClear = () => {
    sigRef.current?.clear();
  };

  const handleApplyDraw = () => {
    if (sigRef.current?.isEmpty()) return;
    const dataUrl = sigRef.current!.toDataURL('image/png');
    onApply(dataUrl);
    onClose();
  };

  const handleApplyType = () => {
    if (!typedName.trim()) return;
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 120;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 400, 120);
    ctx.font = `60px ${signatureFont}`;
    ctx.fillStyle = color;
    ctx.fillText(typedName, 20, 90);
    onApply(canvas.toDataURL('image/png'));
    onClose();
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      onApply(dataUrl);
      onClose();
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-700">
          <h2 className="text-lg font-semibold text-white">Add Signature</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-700">
          {(['draw', 'type', 'upload'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'flex-1 py-2.5 text-sm font-medium capitalize transition-colors',
                tab === t ? 'text-blue-400 border-b-2 border-blue-400' : 'text-zinc-400 hover:text-zinc-200'
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="p-4">
          {tab === 'draw' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 mb-1">
                <label className="text-xs text-zinc-400">Ink color</label>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-7 h-7 rounded" />
              </div>
              <div className="border border-zinc-700 rounded-lg overflow-hidden bg-white">
                <SignatureCanvas
                  ref={sigRef}
                  penColor={color}
                  canvasProps={{ width: 460, height: 160, className: 'sig-canvas block' }}
                />
              </div>
              <p className="text-xs text-zinc-500">Draw your signature above</p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleClear}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors"
                >
                  <RotateCcw size={14} /> Clear
                </button>
                <button
                  onClick={handleApplyDraw}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors ml-auto"
                >
                  <Check size={14} /> Apply Signature
                </button>
              </div>
            </div>
          )}

          {tab === 'type' && (
            <div className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="Type your name..."
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex items-center gap-3">
                <select
                  value={signatureFont}
                  onChange={(e) => setSignatureFont(e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-300 text-sm flex-1"
                >
                  {SIGNATURE_FONTS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-8 h-8 rounded" />
              </div>
              {typedName && (
                <div
                  className="border border-zinc-700 rounded-lg bg-white p-4 text-center"
                  style={{ fontFamily: signatureFont, fontSize: 48, color, minHeight: 80, lineHeight: 1.2 }}
                >
                  {typedName}
                </div>
              )}
              <button
                onClick={handleApplyType}
                disabled={!typedName.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors mt-2 disabled:opacity-40"
              >
                <Check size={14} /> Apply Signature
              </button>
            </div>
          )}

          {tab === 'upload' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-3 border-2 border-dashed border-zinc-600 hover:border-zinc-400 rounded-xl p-10 cursor-pointer w-full transition-colors"
              >
                <Upload size={32} className="text-zinc-500" />
                <p className="text-sm text-zinc-400">Click to upload signature image</p>
                <p className="text-xs text-zinc-500">PNG, JPG, SVG with transparent background preferred</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleUpload}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
