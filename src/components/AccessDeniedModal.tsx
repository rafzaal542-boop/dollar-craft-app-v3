import React from 'react';
import { ShieldAlert, Lock, ArrowRight } from 'lucide-react';

interface AccessDeniedModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail?: string;
}

export const AccessDeniedModal: React.FC<AccessDeniedModalProps> = ({
  isOpen,
  onClose,
  userEmail
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-md bg-[#0B0F19] border border-rose-500/40 rounded-3xl p-6 sm:p-8 text-center text-white shadow-[0_0_50px_rgba(244,63,94,0.25)] space-y-5">
        
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-500/20 to-red-600/10 border border-rose-500/40 flex items-center justify-center text-rose-400 mx-auto shadow-lg shadow-rose-500/10 animate-pulse">
          <ShieldAlert className="w-8 h-8 text-rose-400" />
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[11px] font-mono font-bold uppercase tracking-wider">
            <Lock className="w-3 h-3" />
            <span>Access Denied</span>
          </div>

          <h3 className="text-xl font-black text-white tracking-tight">
            Restricted Admin Control
          </h3>

          <p className="text-xs text-slate-300 leading-relaxed">
            You do not have administrative permissions to view the Admin Control Panel.
            Access is strictly limited to authorized sovereign administrators (<span className="text-amber-400 font-mono font-bold">dollarcraft3@gmail.com</span>).
          </p>

          {userEmail && (
            <p className="text-[11px] font-mono text-slate-500 pt-1">
              Logged in as: <span className="text-slate-400">{userEmail}</span>
            </p>
          )}
        </div>

        <button
          onClick={onClose}
          className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
        >
          <span>Return to Customer Dashboard</span>
          <ArrowRight className="w-4 h-4 text-black" />
        </button>
      </div>
    </div>
  );
};
