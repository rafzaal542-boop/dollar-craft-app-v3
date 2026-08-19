import React, { useState } from 'react';

export function MessengerSupportButton() {
  const [isHovered, setIsHovered] = useState(false);
  const supportUrl = "https://www.facebook.com/share/18zs5yvUw3";

  return (
    <div 
      id="messenger-support-container"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 select-none"
    >
      {/* Expandable tooltip on hover */}
      <div 
        className={`hidden sm:flex items-center bg-slate-900/90 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg border border-blue-500/20 backdrop-blur-sm transition-all duration-300 pointer-events-none ${
          isHovered ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'
        }`}
      >
        <span className="flex h-2 w-2 relative mr-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
        Support Online &bull; Chat with us
      </div>

      {/* Floating Circular Messenger Button */}
      <a
        id="messenger-support-btn"
        href={supportUrl}
        target="_blank"
        rel="noopener noreferrer"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        aria-label="Chat with Support on Messenger"
        title="Chat on Facebook Messenger"
        className="group relative flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-tr from-[#006AFF] via-[#0084FF] to-[#00C6FF] text-white shadow-xl shadow-blue-500/30 hover:shadow-blue-500/50 hover:scale-110 active:scale-95 transition-all duration-300 border-2 border-white/20"
      >
        {/* Subtle pulsating outer ring */}
        <span className="absolute -inset-1 rounded-full bg-blue-500/30 animate-pulse group-hover:bg-blue-400/40 transition-all pointer-events-none" />

        {/* Facebook Messenger Vector Icon */}
        <svg
          viewBox="0 0 24 24"
          className="w-7 h-7 fill-current relative z-10 transition-transform group-hover:rotate-6 drop-shadow"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M12 2C6.477 2 2 6.145 2 11.258c0 2.908 1.45 5.508 3.722 7.152.193.139.314.359.324.598l.063 1.868a.8.8 0 0 0 1.157.712l2.083-.923a.81.81 0 0 1 .533-.038c.683.189 1.397.29 2.118.29 5.523 0 10-4.145 10-9.258C22 6.145 17.523 2 12 2Zm5.187 7.734-2.825 4.475a1.2 1.2 0 0 1-1.683.333l-2.25-1.688a.4.4 0 0 0-.48 0l-3.042 2.31c-.41.312-.962-.16-.713-.604l2.825-4.475a1.2 1.2 0 0 1 1.683-.333l2.25 1.688a.4.4 0 0 0 .48 0l3.042-2.31c.41-.312.962.16.713.604Z" />
        </svg>

        {/* Online Status Badge */}
        <span className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 bg-emerald-500 border-2 border-slate-900 rounded-full z-20 shadow-sm" />
      </a>
    </div>
  );
}
