import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mail, MapPin, Send, ExternalLink, Copy, Check } from 'lucide-react';
import { EmailLogo } from './EmailLogo';

interface ContactModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ContactModal: React.FC<ContactModalProps> = ({
  isOpen,
  onClose
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopyEmail = () => {
    navigator.clipboard.writeText('dollarcraft3@gmail.com');
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleOpenEmail = (e: React.MouseEvent) => {
    // Universal trigger for PC and Mobile
    const emailTo = 'dollarcraft3@gmail.com';
    const subject = encodeURIComponent('Dollar Craft Official 24/7 Support Inquiry');
    const body = encodeURIComponent('Hello Dollar Craft Support Team,\n\nI need assistance with:\n- Account Email:\n- Inquiry Details:\n\nThank you.');

    // Copy to clipboard as quick assistance
    try {
      navigator.clipboard.writeText(emailTo);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {}

    // Check if on PC or Mobile
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isMobile) {
      // Mobile native client launch
      window.location.href = `mailto:${emailTo}?subject=${subject}&body=${body}`;
    } else {
      // PC: Open Gmail Web Composer directly in new tab (guaranteed to work on PC without desktop email client installed)
      const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${emailTo}&su=${subject}&body=${body}`;
      window.open(gmailUrl, '_blank', 'noopener,noreferrer');
      
      // Fallback: Also invoke mailto iframe silently
      try {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = `mailto:${emailTo}?subject=${subject}&body=${body}`;
        document.body.appendChild(iframe);
        setTimeout(() => document.body.removeChild(iframe), 2000);
      } catch (err) {}
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 overflow-y-auto overflow-x-hidden bg-black/85 backdrop-blur-md p-2 sm:p-4 w-full max-w-full flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-lg bg-[#0B0F17] border border-cyan-500/30 rounded-3xl shadow-2xl shadow-cyan-500/20 p-6 md:p-8 text-white overflow-hidden space-y-6 text-left"
        >
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Header */}
          <div className="flex items-center gap-3 border-b border-slate-800/80 pb-4">
            <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center p-2.5 shrink-0 shadow-lg shadow-cyan-500/10">
              <EmailLogo className="w-full h-full" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-white uppercase tracking-wider font-mono">
                Contact Dollar Craft
              </h2>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                24/7 Global Institutional Support Desk
              </p>
            </div>
          </div>

          {/* Direct Contact Details */}
          <div className="space-y-4">
            <div className="p-5 bg-[#07090E] border border-slate-800 rounded-2xl space-y-4 shadow-inner">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center p-2 shrink-0">
                    <EmailLogo className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-xs font-mono font-bold text-slate-400 uppercase">Official Support Email</h4>
                    <p className="text-sm text-cyan-300 font-mono font-bold select-all mt-0.5">dollarcraft3@gmail.com</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCopyEmail}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 hover:border-cyan-500/50 text-slate-300 hover:text-white text-xs font-mono flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400 font-bold">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-t border-slate-800/80 pt-3 gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center p-2 shrink-0">
                    <EmailLogo className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-xs font-mono font-bold text-slate-400 uppercase">24/7 Live Support</h4>
                    <span className="text-sm text-cyan-300 font-mono font-bold mt-0.5 block">
                      24/7 Email Support Desk
                    </span>
                  </div>
                </div>

                {/* Professional Live 24/7 Email Support Button */}
                <div className="flex flex-col sm:items-end items-start gap-1">
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 text-[9px] font-mono font-black uppercase shadow-sm">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                    </span>
                    <span>24/7 LIVE</span>
                  </div>

                  <button
                    type="button"
                    onClick={handleOpenEmail}
                    className="px-3.5 py-2 bg-gradient-to-r from-cyan-500 via-teal-500 to-emerald-500 hover:from-cyan-400 hover:to-teal-400 text-slate-950 font-black rounded-xl text-xs font-mono flex items-center gap-2 shadow-md shadow-cyan-500/25 transition-all cursor-pointer hover:scale-[1.03] active:scale-[0.98]"
                  >
                    <EmailLogo className="w-4 h-4 shrink-0" />
                    <span className="uppercase tracking-wide">Email Support 24/7</span>
                    <ExternalLink className="w-3 h-3 stroke-[2.5]" />
                  </button>
                </div>
              </div>

              {/* Messenger Support Row */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-t border-slate-800/80 pt-3 gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center p-2 shrink-0">
                    <svg viewBox="0 0 24 24" className="w-6 h-6 fill-[#0084FF]" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 2C6.477 2 2 6.145 2 11.258c0 2.908 1.45 5.508 3.722 7.152.193.139.314.359.324.598l.063 1.868a.8.8 0 0 0 1.157.712l2.083-.923a.81.81 0 0 1 .533-.038c.683.189 1.397.29 2.118.29 5.523 0 10-4.145 10-9.258C22 6.145 17.523 2 12 2Zm5.187 7.734-2.825 4.475a1.2 1.2 0 0 1-1.683.333l-2.25-1.688a.4.4 0 0 0-.48 0l-3.042 2.31c-.41.312-.962-.16-.713-.604l2.825-4.475a1.2 1.2 0 0 1 1.683-.333l2.25 1.688a.4.4 0 0 0 .48 0l3.042-2.31c.41-.312.962.16.713.604Z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-xs font-mono font-bold text-slate-400 uppercase">Live Messenger Support</h4>
                    <span className="text-sm text-blue-400 font-mono font-bold mt-0.5 block">
                      Facebook Messenger
                    </span>
                  </div>
                </div>

                <div className="flex flex-col sm:items-end items-start gap-1">
                  <a
                    href="https://www.facebook.com/share/18zs5yvUw3"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-2 bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white font-black rounded-xl text-xs font-mono flex items-center gap-2 shadow-md shadow-blue-500/25 transition-all cursor-pointer hover:scale-[1.03] active:scale-[0.98]"
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current shrink-0" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 2C6.477 2 2 6.145 2 11.258c0 2.908 1.45 5.508 3.722 7.152.193.139.314.359.324.598l.063 1.868a.8.8 0 0 0 1.157.712l2.083-.923a.81.81 0 0 1 .533-.038c.683.189 1.397.29 2.118.29 5.523 0 10-4.145 10-9.258C22 6.145 17.523 2 12 2Zm5.187 7.734-2.825 4.475a1.2 1.2 0 0 1-1.683.333l-2.25-1.688a.4.4 0 0 0-.48 0l-3.042 2.31c-.41.312-.962-.16-.713-.604l2.825-4.475a1.2 1.2 0 0 1 1.683-.333l2.25 1.688a.4.4 0 0 0 .48 0l3.042-2.31c.41-.312.962.16.713.604Z" />
                    </svg>
                    <span className="uppercase tracking-wide">Open Messenger</span>
                    <ExternalLink className="w-3 h-3 stroke-[2.5]" />
                  </a>
                </div>
              </div>

              <div className="flex items-start gap-3 border-t border-slate-800/80 pt-3">
                <MapPin className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-mono font-bold text-slate-400 uppercase">Registered HQ</h4>
                  <p className="text-sm text-white font-mono font-bold mt-0.5">Dollar Craft Pte Ltd</p>
                  <p className="text-xs text-slate-300 font-mono">c/o Company Name</p>
                  <p className="text-xs text-slate-300 font-mono">70 Bendemeer Road, #03-02</p>
                  <p className="text-xs text-slate-300 font-mono">Luzerne, Singapore 339940</p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

