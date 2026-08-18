import React from 'react';

interface EmailLogoProps {
  className?: string;
  badgeClassName?: string;
  withBadge?: boolean;
}

export const EmailLogo: React.FC<EmailLogoProps> = ({ 
  className = "w-6 h-6",
  badgeClassName = "p-1.5 rounded-xl bg-white/10 border border-white/20 shadow-sm",
  withBadge = false
}) => {
  const svg = (
    <svg 
      className={className} 
      viewBox="0 0 48 48" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Red lower body & folds */}
      <path 
        d="M45 16.2V38C45 40.2091 43.2091 42 41 42H34V22.5L24 30L14 22.5V42H7C4.79086 42 3 40.2091 3 38V16.2L24 31.95L45 16.2Z" 
        fill="#EA4335" 
      />
      {/* Dark red top envelope fold */}
      <path 
        d="M41 6H7C4.79086 6 3 7.79086 3 10V16.2L24 31.95L45 16.2V10C45 7.79086 43.2091 6 41 6Z" 
        fill="#C5221F" 
      />
      {/* Yellow top accent */}
      <path 
        d="M3 10L24 25.75L45 10H3Z" 
        fill="#FBBC04" 
      />
      {/* Blue left pillar */}
      <path 
        d="M3 10V16.2L14 24.5V42H7C4.79086 42 3 40.2091 3 38V10Z" 
        fill="#4285F4" 
      />
      {/* Green right pillar */}
      <path 
        d="M45 10V16.2L34 24.5V42H41C43.2091 42 45 40.2091 45 38V10Z" 
        fill="#34A853" 
      />
    </svg>
  );

  if (withBadge) {
    return (
      <div className={`inline-flex items-center justify-center shrink-0 ${badgeClassName}`}>
        {svg}
      </div>
    );
  }

  return svg;
};
