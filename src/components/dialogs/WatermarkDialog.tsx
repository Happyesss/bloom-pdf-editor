'use client';

import { useState } from 'react';
import { X, Check, Droplets } from 'lucide-react';

interface WatermarkDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (options: {
    text: string;
    fontSize: number;
    color: [number, number, number];
    opacity: number;
    angle: number;
    repeat: boolean;
  }) => void;
}

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16) / 255, parseInt(result[2], 16) / 255, parseInt(result[3], 16) / 255]
    : [0.7, 0.7, 0.7];
}

export default function WatermarkDialog({ open, onClose, onApply }: WatermarkDialogProps) {
  const [text, setText] = useState('CONFIDENTIAL');
  const [fontSize, setFontSize] = useState(48);
  const [color, setColor] = useState('#b0b0b0');
  const [opacity, setOpacity] = useState(40);
  const [angle, setAngle] = useState(45);
  const [repeat, setRepeat] = useState(true);

  if (!open) return null;

  const handleApply = () => {
    if (!text.trim()) return;
    onApply({
      text,
      fontSize,
      color: hexToRgb(color),
      opacity: opacity / 100,
      angle,
      repeat,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-zinc-700">
          <div className="flex items-center gap-2 text-white font-semibold">
            <Droplets size={18} />
            <span>Add Watermark</span>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Watermark Text</label>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Font Size</label>
              <input
                type="number"
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                min={12}
                max={120}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Color</label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-full h-9 rounded-lg border border-zinc-700 cursor-pointer"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-400 block mb-1">Opacity: {opacity}%</label>
            <input
              type="range"
              min={5}
              max={100}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 block mb-1">Rotation: {angle}°</label>
            <input
              type="range"
              min={0}
              max={90}
              value={angle}
              onChange={(e) => setAngle(Number(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={repeat}
              onChange={(e) => setRepeat(e.target.checked)}
              className="accent-blue-500"
            />
            <span className="text-sm text-zinc-300">Repeat watermark across page</span>
          </label>

          {/* Preview */}
          <div className="bg-white rounded-lg h-24 flex items-center justify-center overflow-hidden relative">
            <p
              style={{
                fontFamily: 'Arial',
                fontSize: fontSize * 0.3,
                color,
                opacity: opacity / 100,
                transform: `rotate(-${angle}deg)`,
                userSelect: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {text || 'Preview'}
            </p>
          </div>

          <button
            onClick={handleApply}
            disabled={!text.trim()}
            className="flex items-center justify-center gap-2 w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors disabled:opacity-40"
          >
            <Check size={16} /> Apply Watermark
          </button>
        </div>
      </div>
    </div>
  );
}
