// ── Material-style File Icons ─────────────────────────────────────────────────
// SVG icons colored to match VS Code's material-icon-theme.

import React from 'react';
import { resolveFileIconUrl, resolveFolderIconUrl } from '../../../lib/icon-theme-registry';

interface IconProps {
  className?: string;
}

// ── Base icon wrapper ─────────────────────────────────────────────────────────
function SvgIcon({ children, className = 'h-4 w-4' }: { children: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      {children}
    </svg>
  );
}

// ── TypeScript ────────────────────────────────────────────────────────────────
function TypeScriptIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#3178C6" />
      <path d="M14.5 17V12.5H17V11H10V12.5H12.5V17H14.5Z" fill="white" />
      <path d="M18 14.5C18 13.12 17.1 12.3 15.5 12.3C14.3 12.3 13.5 12.8 13.2 13.5L14.3 14C14.5 13.6 14.8 13.4 15.4 13.4C16 13.4 16.4 13.7 16.4 14.1C16.4 14.9 13.2 14.7 13.2 16.8C13.2 17.8 14 18.5 15.2 18.5C16.2 18.5 17 18 17.4 17.2L16.3 16.7C16.1 17.1 15.7 17.3 15.3 17.3C14.8 17.3 14.5 17.1 14.5 16.7C14.5 15.9 18 16.1 18 14.5Z" fill="white" />
    </SvgIcon>
  );
}

// ── JavaScript ────────────────────────────────────────────────────────────────
function JavaScriptIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#F7DF1E" />
      <path d="M8 18L9.2 17.1C9.5 17.7 9.9 18.1 10.7 18.1C11.5 18.1 11.9 17.7 11.9 16.8V11H13.5V16.8C13.5 18.6 12.4 19.4 10.8 19.4C9.4 19.4 8.5 18.7 8 18Z" fill="#1A1A1A" />
      <path d="M14.5 17.8L15.7 16.9C16.1 17.6 16.7 18.1 17.7 18.1C18.5 18.1 19 17.7 19 17.1C19 16.4 18.5 16.2 17.6 15.8L17.1 15.6C15.7 15 14.8 14.2 14.8 12.6C14.8 11.2 15.9 10.2 17.5 10.2C18.6 10.2 19.5 10.6 20 11.5L18.9 12.5C18.6 12 18.2 11.7 17.5 11.7C16.8 11.7 16.4 12.1 16.4 12.6C16.4 13.2 16.8 13.4 17.6 13.8L18.1 14C19.7 14.7 20.6 15.4 20.6 17.1C20.6 18.9 19.2 19.8 17.7 19.8C16.2 19.8 15.2 19 14.5 17.8Z" fill="#1A1A1A" />
    </SvgIcon>
  );
}

// ── React (TSX/JSX) ──────────────────────────────────────────────────────────
function ReactIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <circle cx="12" cy="12" r="2.5" fill="#61DAFB" />
      <ellipse cx="12" cy="12" rx="9" ry="3.5" stroke="#61DAFB" strokeWidth="1" fill="none" />
      <ellipse cx="12" cy="12" rx="9" ry="3.5" stroke="#61DAFB" strokeWidth="1" fill="none" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="9" ry="3.5" stroke="#61DAFB" strokeWidth="1" fill="none" transform="rotate(120 12 12)" />
    </SvgIcon>
  );
}

// ── JSON ──────────────────────────────────────────────────────────────────────
function JsonIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M5 3H7C8.1 3 9 3.9 9 5V8C9 9.1 9.9 10 11 10H12V12H11C9.9 12 9 12.9 9 14V17C9 18.1 8.1 19 7 19H5V17H7V14C7 12.9 7.9 12 9 12C7.9 12 7 11.1 7 10V7H5V5Z" fill="#F5C842" />
      <path d="M19 3H17C15.9 3 15 3.9 15 5V8C15 9.1 14.1 10 13 10H12V12H13C14.1 12 15 12.9 15 14V17C15 18.1 15.9 19 17 19H19V17H17V14C17 12.9 16.1 12 15 12C16.1 12 17 11.1 17 10V7H19V5Z" fill="#F5C842" />
    </SvgIcon>
  );
}

// ── Rust ───────────────────────────────────────────────────────────────────────
function RustIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="#DEA584" strokeWidth="1.5" />
      <path d="M12 6L13.5 9.5H10.5L12 6Z" fill="#DEA584" />
      <rect x="9" y="10" width="6" height="2" rx="1" fill="#DEA584" />
      <rect x="9" y="13" width="6" height="2" rx="1" fill="#DEA584" />
      <path d="M7 12H5M19 12H17M12 5V3M12 21V19" stroke="#DEA584" strokeWidth="1.5" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── Python ────────────────────────────────────────────────────────────────────
function PythonIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M11.9 2C7.4 2 7.8 3.8 7.8 3.8V5.7H12V6.5H5.8C5.8 6.5 2 6.1 2 11C2 15.9 5.3 15.7 5.3 15.7H7V13.5C7 13.5 6.9 10.2 10.3 10.2H13.6C13.6 10.2 16.6 10.3 16.6 7.4V4.2C16.6 4.2 17 2 11.9 2ZM9.8 3.5C10.3 3.5 10.7 3.9 10.7 4.4C10.7 4.9 10.3 5.3 9.8 5.3C9.3 5.3 8.9 4.9 8.9 4.4C8.9 3.9 9.3 3.5 9.8 3.5Z" fill="#3776AB" />
      <path d="M12.1 22C16.6 22 16.2 20.2 16.2 20.2V18.3H12V17.5H18.2C18.2 17.5 22 17.9 22 13C22 8.1 18.7 8.3 18.7 8.3H17V10.5C17 10.5 17.1 13.8 13.7 13.8H10.4C10.4 13.8 7.4 13.7 7.4 16.6V19.8C7.4 19.8 7 22 12.1 22ZM14.2 20.5C13.7 20.5 13.3 20.1 13.3 19.6C13.3 19.1 13.7 18.7 14.2 18.7C14.7 18.7 15.1 19.1 15.1 19.6C15.1 20.1 14.7 20.5 14.2 20.5Z" fill="#FFD43B" />
    </SvgIcon>
  );
}

// ── HTML ──────────────────────────────────────────────────────────────────────
function HtmlIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M4 2L5.5 20L12 22L18.5 20L20 2H4Z" fill="#E44D26" />
      <path d="M12 4V20L17 18.5L18.3 4H12Z" fill="#F16529" />
      <path d="M8 7H16L15.8 9H8.2L8.4 11H15.6L15 17L12 18L9 17L8.8 14H10.5L10.6 15.5L12 16L13.4 15.5L13.6 12H8L7.5 7Z" fill="white" />
    </SvgIcon>
  );
}

// ── CSS ───────────────────────────────────────────────────────────────────────
function CssIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M4 2L5.5 20L12 22L18.5 20L20 2H4Z" fill="#1572B6" />
      <path d="M12 4V20L17 18.5L18.3 4H12Z" fill="#33A9DC" />
      <path d="M16 7H8L8.2 9H15.8L15 17L12 18L9 17L8.8 14H10.5L10.6 15.5L12 16L13.4 15.5L13.6 12H8.4L8 7Z" fill="white" />
    </SvgIcon>
  );
}

// ── Markdown ──────────────────────────────────────────────────────────────────
function MarkdownIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="4" width="20" height="16" rx="2" fill="none" stroke="#519ABA" strokeWidth="1.5" />
      <path d="M5 15V9H7L9 11.5L11 9H13V15H11V11.5L9 14L7 11.5V15H5Z" fill="#519ABA" />
      <path d="M17 15L14 12H16V9H18V12H20L17 15Z" fill="#519ABA" />
    </SvgIcon>
  );
}

// ── Git ───────────────────────────────────────────────────────────────────────
function GitIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M21.6 11.2L12.8 2.4C12.4 2 11.6 2 11.2 2.4L9 4.6L11.7 7.3C12.2 7.1 12.8 7.2 13.2 7.6C13.7 8.1 13.7 8.7 13.4 9.2L16 11.8C16.5 11.5 17.2 11.6 17.6 12C18.1 12.5 18.1 13.3 17.6 13.8C17.1 14.3 16.3 14.3 15.8 13.8C15.4 13.4 15.3 12.7 15.6 12.2L13.2 9.8V15C13.4 15.1 13.6 15.3 13.7 15.5C14.2 16 14.2 16.8 13.7 17.3C13.2 17.8 12.4 17.8 11.9 17.3C11.4 16.8 11.4 16 11.9 15.5C12.1 15.3 12.3 15.2 12.5 15.1V9.6C12.3 9.5 12.1 9.4 11.9 9.2C11.5 8.8 11.4 8.1 11.7 7.6L9 4.9L2.4 11.5C2 11.9 2 12.7 2.4 13.1L11.2 21.9C11.6 22.3 12.4 22.3 12.8 21.9L21.6 13.1C22 12.7 22 11.9 21.6 11.2Z" fill="#F05033" />
    </SvgIcon>
  );
}

// ── SVG icon ─────────────────────────────────────────────────────────────────
function SvgFileIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M4 4C4 2.9 4.9 2 6 2H14L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4Z" fill="#FFB300" />
      <path d="M14 2L20 8H14V2Z" fill="#FF8F00" />
      <path d="M8 13L10 11L12 15L14 12L16 14" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </SvgIcon>
  );
}

// ── Image ────────────────────────────────────────────────────────────────────
function ImageIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" fill="#26A69A" />
      <circle cx="8.5" cy="8.5" r="2" fill="white" opacity="0.7" />
      <path d="M3 16L8 11L13 16L16 13L21 18V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V16Z" fill="white" opacity="0.5" />
    </SvgIcon>
  );
}

// ── YAML/TOML (config) ──────────────────────────────────────────────────────
function ConfigIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M4 4C4 2.9 4.9 2 6 2H14L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4Z" fill="#8E8E93" />
      <path d="M14 2L20 8H14V2Z" fill="#636366" />
      <path d="M8 12H16M8 15H14M8 18H12" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── SQL ───────────────────────────────────────────────────────────────────────
function SqlIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <ellipse cx="12" cy="6" rx="8" ry="3" fill="#00897B" />
      <path d="M4 6V18C4 19.7 7.6 21 12 21C16.4 21 20 19.7 20 18V6" fill="none" stroke="#00897B" strokeWidth="1.5" />
      <ellipse cx="12" cy="12" rx="8" ry="3" fill="none" stroke="#00897B" strokeWidth="1" />
      <ellipse cx="12" cy="18" rx="8" ry="3" fill="none" stroke="#00897B" strokeWidth="1" />
    </SvgIcon>
  );
}

// ── Shell/Bash ──────────────────────────────────────────────────────────────
function ShellIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="3" width="20" height="18" rx="2" fill="#4CAF50" />
      <path d="M6 8L10 12L6 16" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 16H18" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── Lock/lockfile ───────────────────────────────────────────────────────────
function LockIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M4 4C4 2.9 4.9 2 6 2H14L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4Z" fill="#78909C" />
      <path d="M14 2L20 8H14V2Z" fill="#546E7A" />
      <rect x="9" y="12" width="6" height="5" rx="1" fill="white" />
      <path d="M10 12V10C10 8.9 10.9 8 12 8C13.1 8 14 8.9 14 10V12" fill="none" stroke="white" strokeWidth="1.5" />
    </SvgIcon>
  );
}

// ── Generic file ─────────────────────────────────────────────────────────────
function GenericFileIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M4 4C4 2.9 4.9 2 6 2H14L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4Z" fill="#90A4AE" />
      <path d="M14 2L20 8H14V2Z" fill="#78909C" />
    </SvgIcon>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NEW LANGUAGE ICONS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Java ──────────────────────────────────────────────────────────────────────
function JavaIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#E76F00" />
      <path d="M8 18C8 18 9 19 12 19C15 19 16 18 16 18" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 15C9 15 8 16.5 12 16.5C16 16.5 15 15 15 15" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 8H14V11H10V8Z" fill="white" />
      <path d="M10 5H14V7H10V5Z" fill="white" opacity="0.6" />
    </SvgIcon>
  );
}

// ── C ─────────────────────────────────────────────────────────────────────────
function CIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#00599C" />
      <path d="M15.5 8.5C14.5 7.5 13.3 7 12 7C9.2 7 7 9.2 7 12C7 14.8 9.2 17 12 17C13.3 17 14.5 16.5 15.5 15.5" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── C++ ───────────────────────────────────────────────────────────────────────
function CppIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#00599C" />
      <path d="M14 8.5C13.2 7.5 12.2 7 11 7C8.5 7 6.5 9.2 6.5 12C6.5 14.8 8.5 17 11 17C12.2 17 13.2 16.5 14 15.5" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <path d="M15.5 9H18.5M17 7.5V10.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M15.5 13H18.5M17 11.5V14.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── C# ────────────────────────────────────────────────────────────────────────
function CsharpIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#68217A" />
      <path d="M14 8.5C13.2 7.5 12.2 7 11 7C8.5 7 6.5 9.2 6.5 12C6.5 14.8 8.5 17 11 17C12.2 17 13.2 16.5 14 15.5" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 8V16M18 8V16M15.5 10H18.5M15.5 14H18.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── Go ────────────────────────────────────────────────────────────────────────
function GoIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#00ADD8" />
      <circle cx="9" cy="12" r="2.5" fill="white" />
      <circle cx="15" cy="12" r="2.5" fill="white" />
      <path d="M9 9.5C9 9.5 7.5 8 6 9.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <path d="M15 9.5C15 9.5 16.5 8 18 9.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </SvgIcon>
  );
}

// ── Ruby ──────────────────────────────────────────────────────────────────────
function RubyIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#CC342D" />
      <path d="M12 5L16 12L12 19L8 12L12 5Z" fill="white" opacity="0.9" />
      <path d="M12 8L14 12L12 16L10 12L12 8Z" fill="#CC342D" />
    </SvgIcon>
  );
}

// ── PHP ───────────────────────────────────────────────────────────────────────
function PhpIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#777BB4" />
      <path d="M7 16L8 8H10.5C12 8 13 8.8 13 10.2C13 12 11.5 13 9.8 13H8.5L8 16H7ZM8.7 11.5H9.8C10.8 11.5 11.5 11 11.5 10.2C11.5 9.5 11 9.2 10.2 9.2H9.3L8.7 11.5Z" fill="white" />
      <path d="M13.5 16L14.5 8H17C18.5 8 19.5 8.8 19.5 10.2C19.5 12 18 13 16.3 13H15L14.5 16H13.5ZM15.2 11.5H16.3C17.3 11.5 18 11 18 10.2C18 9.5 17.5 9.2 16.7 9.2H15.8L15.2 11.5Z" fill="white" />
    </SvgIcon>
  );
}

// ── Swift ─────────────────────────────────────────────────────────────────────
function SwiftIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#F05138" />
      <path d="M12 6C14 8 17 10 18 11C17 10 14 9 12 9C10 9 7 10 6 11C7 10 10 8 12 6Z" fill="white" />
      <path d="M6 11C7 13 9 16 12 16C15 16 17 13 18 11" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M8 13L6 15L7 16L9 14" fill="white" />
    </SvgIcon>
  );
}

// ── Kotlin ────────────────────────────────────────────────────────────────────
function KotlinIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#7F52FF" />
      <path d="M12 6L18 6L12 12L18 18H12L6 12L12 6Z" fill="white" />
    </SvgIcon>
  );
}

// ── Dart ──────────────────────────────────────────────────────────────────────
function DartIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#0175C2" />
      <path d="M8 16L18 6L18 14L14 18L8 16Z" fill="white" />
      <path d="M6 14L8 16L8 10L6 14Z" fill="white" opacity="0.7" />
    </SvgIcon>
  );
}

// ── Lua ───────────────────────────────────────────────────────────────────────
function LuaIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#000080" />
      <circle cx="15" cy="9" r="3" fill="none" stroke="white" strokeWidth="1.5" />
      <circle cx="12" cy="15" r="3" fill="none" stroke="white" strokeWidth="1.5" />
    </SvgIcon>
  );
}

// ── R ─────────────────────────────────────────────────────────────────────────
function RIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#276DC3" />
      <path d="M7 17V7H11.5C13.5 7 14.5 8 14.5 9.5C14.5 11 13.5 12 12 12.2L15 17H13.5L10.8 12.3H8.5V17H7ZM8.5 11H11.3C12.5 11 13.2 10.5 13.2 9.5C13.2 8.7 12.6 8.2 11.3 8.2H8.5V11Z" fill="white" />
    </SvgIcon>
  );
}

// ── Scala ─────────────────────────────────────────────────────────────────────
function ScalaIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#DC322F" />
      <path d="M6 7H18V9H6V7ZM6 11H15V13H6V11ZM6 15H12V17H6V15Z" fill="white" />
      <circle cx="17" cy="12" r="1.5" fill="white" />
    </SvgIcon>
  );
}

// ── Perl ──────────────────────────────────────────────────────────────────────
function PerlIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#39457E" />
      <path d="M7 17L12 7L17 17H15L12 11L9 17H7Z" fill="white" />
      <circle cx="12" cy="15" r="1" fill="#39457E" />
    </SvgIcon>
  );
}

// ── Haskell ───────────────────────────────────────────────────────────────────
function HaskellIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#5D4F85" />
      <path d="M6 17L10 12L6 7H8.5L12.5 12L8.5 17H6Z" fill="white" />
      <path d="M10.5 17L14.5 12L10.5 7H13L17 12L13 17H10.5Z" fill="white" />
      <path d="M15 17H18V15.5H16V14.5H18V13H16V12H18V10.5H15V17Z" fill="white" />
    </SvgIcon>
  );
}

// ── Vue ───────────────────────────────────────────────────────────────────────
function VueIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#35495E" />
      <path d="M12 6L7 14H9.5L12 10L14.5 14H17L12 6Z" fill="#41B883" />
      <path d="M12 9L10 12H14L12 9Z" fill="#35495E" />
    </SvgIcon>
  );
}

// ── Svelte ────────────────────────────────────────────────────────────────────
function SvelteIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#FF3E00" />
      <path d="M15.5 8C14 6 11.5 5.5 10 7C8.5 8.5 9.5 11 11 12.5C12.5 14 15 14.5 16.5 13C18 11.5 17 10 15.5 8Z" fill="white" />
      <path d="M8.5 16C10 18 12.5 18.5 14 17C15.5 15.5 14.5 13 13 11.5C11.5 10 9 9.5 7.5 11C6 12.5 7 14 8.5 16Z" fill="white" opacity="0.6" />
    </SvgIcon>
  );
}

// ── Angular ───────────────────────────────────────────────────────────────────
function AngularIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#DD0031" />
      <path d="M12 5L6 8L7.5 15.5L12 18L16.5 15.5L18 8L12 5Z" fill="white" />
      <path d="M12 7L8.5 14.5H10L10.8 12.5H13.2L14 14.5H15.5L12 7ZM12.8 11.5H11.2L12 9.5L12.8 11.5Z" fill="#DD0031" />
    </SvgIcon>
  );
}

// ── Next.js ───────────────────────────────────────────────────────────────────
function NextJsIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#0A0A0A" />
      <path d="M8 7H10L14 13.5V7H16V17H14L10 10.5V17H8V7Z" fill="white" />
    </SvgIcon>
  );
}

// ── Objective-C ───────────────────────────────────────────────────────────────
function ObjectiveCIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#438EFF" />
      <path d="M7 17V7H11C13 7 14 8 14 9.5C14 11 13 12 11.5 12.2L14.5 17H12.8L10 12.3H8.5V17H7ZM8.5 11H10.8C12 11 12.5 10.5 12.5 9.5C12.5 8.7 12 8.2 10.8 8.2H8.5V11Z" fill="white" />
      <circle cx="16" cy="15" r="1.5" fill="white" />
    </SvgIcon>
  );
}

// ── Groovy ────────────────────────────────────────────────────────────────────
function GroovyIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#4298B8" />
      <path d="M7 17V7H11.5C13.5 7 14.5 8 14.5 9.5C14.5 11.2 13.3 12.2 11.5 12.2H8.5V17H7ZM8.5 11H11.2C12.3 11 13 10.5 13 9.5C13 8.7 12.4 8.2 11.2 8.2H8.5V11Z" fill="white" />
      <circle cx="17" cy="12" r="2" fill="none" stroke="white" strokeWidth="1.2" />
    </SvgIcon>
  );
}

// ── MATLAB ────────────────────────────────────────────────────────────────────
function MatlabIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#FF8000" />
      <path d="M6 17L10 7L12 13L14 7L18 17H16L14 12L12 17L10 12L8 17H6Z" fill="white" />
    </SvgIcon>
  );
}

// ── Julia ─────────────────────────────────────────────────────────────────────
function JuliaIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#1A1A1A" />
      <circle cx="9" cy="8" r="2.5" fill="#CB3C33" />
      <circle cx="15" cy="8" r="2.5" fill="#9558B2" />
      <circle cx="12" cy="15" r="2.5" fill="#389826" />
    </SvgIcon>
  );
}

// ── Fortran ───────────────────────────────────────────────────────────────────
function FortranIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#734F96" />
      <path d="M7 17V7H13V8.5H8.5V11H12.5V12.5H8.5V17H7Z" fill="white" />
    </SvgIcon>
  );
}

// ── Assembly ──────────────────────────────────────────────────────────────────
function AssemblyIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#6E7681" />
      <path d="M6 17L10 7L14 17H12.5L11.5 14.5H8.5L7.5 17H6ZM9 13H11L10 10.5L9 13Z" fill="white" />
    </SvgIcon>
  );
}

// ── F# ────────────────────────────────────────────────────────────────────────
function FsharpIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#378BBA" />
      <path d="M7 17V7H8.5V11H12.5V12.5H8.5V17H7Z" fill="white" />
      <path d="M14 9H17M15.5 7.5V10.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 13H17M15.5 11.5V14.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── OCaml ─────────────────────────────────────────────────────────────────────
function OCamlIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#EC6813" />
      <path d="M7 17V7H8.5V15.5H12V17H7Z" fill="white" />
      <path d="M13 17V7H14.5V15.5H18V17H13Z" fill="white" />
    </SvgIcon>
  );
}

// ── PowerShell ────────────────────────────────────────────────────────────────
function PowershellIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#5391FE" />
      <path d="M7 7L13 12L7 17" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 16H17" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── Vim ───────────────────────────────────────────────────────────────────────
function VimIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#019733" />
      <path d="M7 7L12 17L17 7H15L12 13L9 7H7Z" fill="white" />
    </SvgIcon>
  );
}

// ── COBOL ─────────────────────────────────────────────────────────────────────
function CobolIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#005CA5" />
      <path d="M7 17V7H11C13 7 14 8 14 9.5C14 11 13 12 11.5 12.2L14.5 17H12.8L10 12.3H8.5V17H7ZM8.5 11H10.8C12 11 12.5 10.5 12.5 9.5C12.5 8.7 12 8.2 10.8 8.2H8.5V11Z" fill="white" />
    </SvgIcon>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NEW FILE TYPE / TOOL ICONS
// ═══════════════════════════════════════════════════════════════════════════════

// ── XML ───────────────────────────────────────────────────────────────────────
function XmlIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#F29F24" />
      <path d="M7 16L5 12L7 8" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M17 16L19 12L17 8" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M10 17L14 7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── CSV ───────────────────────────────────────────────────────────────────────
function CsvIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#4CAF50" />
      <path d="M6 6H10V10H6V6Z" fill="white" opacity="0.9" />
      <path d="M12 6H18V7H12V6Z" fill="white" opacity="0.7" />
      <path d="M12 8H16V9H12V8Z" fill="white" opacity="0.7" />
      <path d="M6 12H10V16H6V12Z" fill="white" opacity="0.6" />
      <path d="M12 12H18V13H12V12Z" fill="white" opacity="0.5" />
      <path d="M12 14H16V15H12V14Z" fill="white" opacity="0.5" />
    </SvgIcon>
  );
}

// ── PDF ───────────────────────────────────────────────────────────────────────
function PdfIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M4 4C4 2.9 4.9 2 6 2H14L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4Z" fill="#E53935" />
      <path d="M14 2L20 8H14V2Z" fill="#C62828" />
      <path d="M8 12H16M8 15H14M8 18H12" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── ZIP / Archive ─────────────────────────────────────────────────────────────
function ZipIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M4 4C4 2.9 4.9 2 6 2H14L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4Z" fill="#FFC107" />
      <path d="M14 2L20 8H14V2Z" fill="#FFA000" />
      <path d="M10 6V12M10 14V16" stroke="#5D4037" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="9" y="12" width="2" height="2" fill="#5D4037" />
    </SvgIcon>
  );
}

// ── Docker ────────────────────────────────────────────────────────────────────
function DockerIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#2496ED" />
      <path d="M6 12H8V14H6V12Z" fill="white" />
      <path d="M9 12H11V14H9V12Z" fill="white" />
      <path d="M12 12H14V14H12V12Z" fill="white" />
      <path d="M9 9H11V11H9V9Z" fill="white" />
      <path d="M12 9H14V11H12V9Z" fill="white" />
      <path d="M15 12H17V14H15V12Z" fill="white" />
      <path d="M5 15H19" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── Makefile / CMake ──────────────────────────────────────────────────────────
function MakefileIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M4 4C4 2.9 4.9 2 6 2H14L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4Z" fill="#90A4AE" />
      <path d="M14 2L20 8H14V2Z" fill="#78909C" />
      <path d="M8 14L10 10L12 14" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M13 14V10H16" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </SvgIcon>
  );
}

// ── Gradle ────────────────────────────────────────────────────────────────────
function GradleIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#02303A" />
      <path d="M7 16C7 16 6 12 9 10C12 8 14 10 14 12C14 14 12 15 12 15" stroke="#6DB33F" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <circle cx="7" cy="16" r="1.5" fill="#6DB33F" />
    </SvgIcon>
  );
}

// ── Maven ─────────────────────────────────────────────────────────────────────
function MavenIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#C71A36" />
      <path d="M12 6L7 16H9L10 14H14L15 16H17L12 6ZM10.5 12.5L12 9L13.5 12.5H10.5Z" fill="white" />
    </SvgIcon>
  );
}

// ── Kubernetes ────────────────────────────────────────────────────────────────
function KubernetesIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#326CE5" />
      <path d="M12 6L14 7V9L12 10L10 9V7L12 6Z" fill="white" />
      <path d="M12 14L14 15V17L12 18L10 17V15L12 14Z" fill="white" opacity="0.7" />
      <path d="M8 10L10 9L11 11L10 13L8 12V10Z" fill="white" opacity="0.7" />
      <path d="M16 10V12L14 13L13 11L14 9L16 10Z" fill="white" opacity="0.7" />
      <circle cx="12" cy="12" r="1.5" fill="white" />
    </SvgIcon>
  );
}

// ── Terraform ─────────────────────────────────────────────────────────────────
function TerraformIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#7B42BC" />
      <path d="M8 7H11V11H8V7Z" fill="white" />
      <path d="M13 7H16V11H13V7Z" fill="white" opacity="0.7" />
      <path d="M8 13H11V17H8V13Z" fill="white" opacity="0.7" />
      <path d="M13 13H16V17H13V13Z" fill="white" opacity="0.4" />
    </SvgIcon>
  );
}

// ── Nginx ─────────────────────────────────────────────────────────────────────
function NginxIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#009900" />
      <path d="M7 17V7L12 10L17 7V17L12 14L7 17Z" fill="white" />
    </SvgIcon>
  );
}

// ── Log ───────────────────────────────────────────────────────────────────────
function LogIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M4 4C4 2.9 4.9 2 6 2H14L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4Z" fill="#9E9E9E" />
      <path d="M14 2L20 8H14V2Z" fill="#757575" />
      <path d="M7 11H17M7 14H15M7 17H12" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── EXE / Binary ──────────────────────────────────────────────────────────────
function ExeIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M4 4C4 2.9 4.9 2 6 2H14L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4Z" fill="#607D8B" />
      <path d="M14 2L20 8H14V2Z" fill="#546E7A" />
      <circle cx="12" cy="14" r="3" fill="none" stroke="white" strokeWidth="1.5" />
      <path d="M12 11V9" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── Word / DOC ────────────────────────────────────────────────────────────────
function DocIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M4 4C4 2.9 4.9 2 6 2H14L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4Z" fill="#2B579A" />
      <path d="M14 2L20 8H14V2Z" fill="#1E3F75" />
      <path d="M8 12H16M8 15H14M8 18H12" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── Excel / XLS ───────────────────────────────────────────────────────────────
function XlsIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M4 4C4 2.9 4.9 2 6 2H14L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4Z" fill="#217346" />
      <path d="M14 2L20 8H14V2Z" fill="#185C37" />
      <path d="M7 9H10V12H7V9ZM12 9H15V12H12V9ZM7 14H10V17H7V14ZM12 14H15V17H12V14Z" stroke="white" strokeWidth="1" fill="none" />
    </SvgIcon>
  );
}

// ── PowerPoint / PPT ──────────────────────────────────────────────────────────
function PptIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M4 4C4 2.9 4.9 2 6 2H14L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4Z" fill="#D24726" />
      <path d="M14 2L20 8H14V2Z" fill="#A53A1F" />
      <circle cx="12" cy="14" r="3" fill="none" stroke="white" strokeWidth="1.5" />
      <path d="M9 14H15" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── Sass ──────────────────────────────────────────────────────────────────────
function SassIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#CC6699" />
      <path d="M12 8C13.5 8 14.5 9 14.5 10.5C14.5 12 13 13 12 13.5C11 14 9.5 14.5 9.5 15.5C9.5 16.2 10 16.5 10.5 16.5C11.2 16.5 11.8 16 12 15.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M12 8C10.5 8 9.5 9 9.5 10.5C9.5 12 11 13 12 13.5C13 14 14.5 14.5 14.5 15.5C14.5 16.2 14 16.5 13.5 16.5C12.8 16.5 12.2 16 12 15.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </SvgIcon>
  );
}

// ── Stylus ────────────────────────────────────────────────────────────────────
function StylusIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#333333" />
      <path d="M6 16L18 8" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6 8H18V16H6V8Z" fill="white" opacity="0.2" />
    </SvgIcon>
  );
}

// ── PostCSS ───────────────────────────────────────────────────────────────────
function PostcssIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#DD3A0A" />
      <path d="M7 12H17M7 9H14M7 15H15" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="16" cy="9" r="1" fill="white" />
      <circle cx="17" cy="15" r="1" fill="white" />
    </SvgIcon>
  );
}

// ── Webpack ───────────────────────────────────────────────────────────────────
function WebpackIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#1C78C0" />
      <path d="M12 6L17 9V15L12 18L7 15V9L12 6Z" fill="none" stroke="white" strokeWidth="1.2" />
      <path d="M12 9L14.5 10.5V13.5L12 15L9.5 13.5V10.5L12 9Z" fill="white" />
    </SvgIcon>
  );
}

// ── Babel ─────────────────────────────────────────────────────────────────────
function BabelIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#F9DC3E" />
      <path d="M8 12C8 12 9 8 12 8C15 8 16 12 16 12C16 12 15 16 12 16C9 16 8 12 8 12Z" fill="none" stroke="#323330" strokeWidth="1.5" />
      <path d="M10 12H14" stroke="#323330" strokeWidth="1.2" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── Vite ──────────────────────────────────────────────────────────────────────
function ViteIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#646CFF" />
      <path d="M12 6L8 16L12 13L16 16L12 6Z" fill="#FFD62E" />
      <path d="M12 13L8 16L12 14.5L16 16L12 13Z" fill="#FFCB2D" />
    </SvgIcon>
  );
}

// ── Tailwind ──────────────────────────────────────────────────────────────────
function TailwindIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#38BDF8" />
      <path d="M8 10C8 10 9 8 12 8C15 8 16 10 16 10C16 10 15 12 12 12C9 12 8 10 8 10Z" fill="white" />
      <path d="M8 14C8 14 9 12 12 12C15 12 16 14 16 14C16 14 15 16 12 16C9 16 8 14 8 14Z" fill="white" opacity="0.7" />
    </SvgIcon>
  );
}

// ── ESLint ────────────────────────────────────────────────────────────────────
function EslintIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#4B32C3" />
      <path d="M12 6L16 8.5V13.5L12 16L8 13.5V8.5L12 6Z" fill="none" stroke="white" strokeWidth="1.5" />
      <path d="M10 11L12 13L14 10" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </SvgIcon>
  );
}

// ── Prettier ──────────────────────────────────────────────────────────────────
function PrettierIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#1A1A1A" />
      <path d="M6 6H9V9H6V6Z" fill="#56B3B4" />
      <path d="M10 6H14V9H10V6Z" fill="#F7B93E" />
      <path d="M15 6H18V9H15V6Z" fill="#EA5E5E" />
      <path d="M6 10H8V13H6V10Z" fill="#F7B93E" />
      <path d="M9 10H13V13H9V10Z" fill="#56B3B4" />
      <path d="M14 10H18V13H14V10Z" fill="#C693C6" />
      <path d="M6 15H11V18H6V15Z" fill="#EA5E5E" />
      <path d="M12 15H15V18H12V15Z" fill="#F7B93E" />
    </SvgIcon>
  );
}

// ── EditorConfig ──────────────────────────────────────────────────────────────
function EditorconfigIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#FEFEFE" />
      <path d="M12 5L15 9L12 13L9 9L12 5Z" fill="#333333" />
      <path d="M12 11L15 15L12 19L9 15L12 11Z" fill="#333333" opacity="0.6" />
    </SvgIcon>
  );
}

// ── License ───────────────────────────────────────────────────────────────────
function LicenseIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M4 4C4 2.9 4.9 2 6 2H14L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4Z" fill="#FF7043" />
      <path d="M14 2L20 8H14V2Z" fill="#E64A19" />
      <path d="M12 11V15M10 13H14" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── README ────────────────────────────────────────────────────────────────────
function ReadmeIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M4 4C4 2.9 4.9 2 6 2H14L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4Z" fill="#42A5F5" />
      <path d="M14 2L20 8H14V2Z" fill="#1E88E5" />
      <path d="M8 12H16M8 15H14M8 18H12" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── CHANGELOG ─────────────────────────────────────────────────────────────────
function ChangelogIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M4 4C4 2.9 4.9 2 6 2H14L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4Z" fill="#66BB6A" />
      <path d="M14 2L20 8H14V2Z" fill="#43A047" />
      <path d="M8 11H16M8 14H14M8 17H12" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="17" cy="11" r="1" fill="white" />
    </SvgIcon>
  );
}

// ── Prisma ────────────────────────────────────────────────────────────────────
function PrismaIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#2D3748" />
      <path d="M12 6L7 16H10L12 12L14 16H17L12 6Z" fill="white" />
    </SvgIcon>
  );
}

// ── GraphQL ───────────────────────────────────────────────────────────────────
function GraphqlIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#E535AB" />
      <path d="M12 6L17 9V15L12 18L7 15V9L12 6Z" fill="none" stroke="white" strokeWidth="1.2" />
      <path d="M7 9H17M12 6V18M9 15L15 9" stroke="white" strokeWidth="1" strokeLinecap="round" />
    </SvgIcon>
  );
}

// ── CI (generic GitHub Actions / GitLab / Jenkins) ────────────────────────────
function CiIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <rect x="2" y="2" width="20" height="20" rx="2" fill="#2088FF" />
      <path d="M8 8H16V10H8V8Z" fill="white" />
      <path d="M8 12H14V14H8V12Z" fill="white" opacity="0.8" />
      <path d="M8 16H12V18H8V16Z" fill="white" opacity="0.6" />
      <path d="M16 12V16" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 14L16 12L18 14" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </SvgIcon>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FOLDER ICONS
// ═══════════════════════════════════════════════════════════════════════════════

export function FolderIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M2 6C2 4.9 2.9 4 4 4H9L11 6H20C21.1 6 22 6.9 22 8V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6Z" fill="#90A4AE" />
      <path d="M2 10H22V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V10Z" fill="#B0BEC5" />
    </SvgIcon>
  );
}

export function FolderOpenIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M2 6C2 4.9 2.9 4 4 4H9L11 6H20C21.1 6 22 6.9 22 8V9H4V6Z" fill="#90A4AE" />
      <path d="M1 10H21L19 20H3L1 10Z" fill="#B0BEC5" />
    </SvgIcon>
  );
}

// Special folder icons
function SrcFolderIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M2 6C2 4.9 2.9 4 4 4H9L11 6H20C21.1 6 22 6.9 22 8V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6Z" fill="#42A5F5" />
      <path d="M2 10H22V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V10Z" fill="#64B5F6" />
    </SvgIcon>
  );
}

function NodeModulesFolderIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M2 6C2 4.9 2.9 4 4 4H9L11 6H20C21.1 6 22 6.9 22 8V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6Z" fill="#689F38" />
      <path d="M2 10H22V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V10Z" fill="#7CB342" />
    </SvgIcon>
  );
}

function GitFolderIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M2 6C2 4.9 2.9 4 4 4H9L11 6H20C21.1 6 22 6.9 22 8V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6Z" fill="#F05033" />
      <path d="M2 10H22V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V10Z" fill="#F4511E" />
    </SvgIcon>
  );
}

function DistFolderIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M2 6C2 4.9 2.9 4 4 4H9L11 6H20C21.1 6 22 6.9 22 8V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6Z" fill="#FFA726" />
      <path d="M2 10H22V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V10Z" fill="#FFB74D" />
    </SvgIcon>
  );
}

function TestFolderIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M2 6C2 4.9 2.9 4 4 4H9L11 6H20C21.1 6 22 6.9 22 8V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6Z" fill="#AB47BC" />
      <path d="M2 10H22V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V10Z" fill="#BA68C8" />
    </SvgIcon>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAPPING TABLES
// ═══════════════════════════════════════════════════════════════════════════════

const SPECIAL_FILES: Record<string, React.FC<IconProps>> = {
  'package.json': JsonIcon,
  'tsconfig.json': TypeScriptIcon,
  'tsconfig.base.json': TypeScriptIcon,
  '.gitignore': GitIcon,
  '.gitattributes': GitIcon,
  'cargo.toml': RustIcon,
  'cargo.lock': LockIcon,
  'pnpm-lock.yaml': LockIcon,
  'package-lock.json': LockIcon,
  'yarn.lock': LockIcon,
  'dockerfile': DockerIcon,
  'docker-compose.yml': DockerIcon,
  'docker-compose.yaml': DockerIcon,
  '.eslintrc': EslintIcon,
  '.eslintrc.json': EslintIcon,
  '.eslintrc.js': EslintIcon,
  '.prettierrc': PrettierIcon,
  '.prettierrc.json': PrettierIcon,
  '.prettierrc.js': PrettierIcon,
  '.editorconfig': EditorconfigIcon,
  'vite.config.ts': ViteIcon,
  'vite.config.js': ViteIcon,
  'vite.config.mjs': ViteIcon,
  'tailwind.config.ts': TailwindIcon,
  'tailwind.config.js': TailwindIcon,
  'webpack.config.js': WebpackIcon,
  'webpack.config.ts': WebpackIcon,
  'babel.config.js': BabelIcon,
  'babel.config.json': BabelIcon,
  '.babelrc': BabelIcon,
  'pom.xml': MavenIcon,
  'makefile': MakefileIcon,
  'cmake': MakefileIcon,
  'cmakelists.txt': MakefileIcon,
  'gradle': GradleIcon,
  'gradlew': GradleIcon,
  'jenkinsfile': CiIcon,
  '.gitlab-ci.yml': CiIcon,
  'license': LicenseIcon,
  'license.md': LicenseIcon,
  'license.txt': LicenseIcon,
  'readme': ReadmeIcon,
  'readme.md': ReadmeIcon,
  'readme.txt': ReadmeIcon,
  'changelog': ChangelogIcon,
  'changelog.md': ChangelogIcon,
};

const EXT_ICONS: Record<string, React.FC<IconProps>> = {
  // Languages
  ts: TypeScriptIcon,
  tsx: ReactIcon,
  js: JavaScriptIcon,
  jsx: ReactIcon,
  json: JsonIcon,
  rs: RustIcon,
  py: PythonIcon,
  java: JavaIcon,
  jar: JavaIcon,
  class: JavaIcon,
  c: CIcon,
  cpp: CppIcon,
  cc: CppIcon,
  cxx: CppIcon,
  h: CIcon,
  hpp: CppIcon,
  cs: CsharpIcon,
  go: GoIcon,
  rb: RubyIcon,
  erb: RubyIcon,
  gemspec: RubyIcon,
  php: PhpIcon,
  phtml: PhpIcon,
  swift: SwiftIcon,
  kt: KotlinIcon,
  kts: KotlinIcon,
  dart: DartIcon,
  lua: LuaIcon,
  r: RIcon,
  rmd: RIcon,
  scala: ScalaIcon,
  sc: ScalaIcon,
  pl: PerlIcon,
  pm: PerlIcon,
  hs: HaskellIcon,
  lhs: HaskellIcon,
  vue: VueIcon,
  svelte: SvelteIcon,
  mjs: JavaScriptIcon,
  // Web
  html: HtmlIcon,
  htm: HtmlIcon,
  css: CssIcon,
  scss: SassIcon,
  sass: SassIcon,
  less: CssIcon,
  styl: StylusIcon,
  stylis: StylusIcon,
  postcss: PostcssIcon,
  // Data / Config
  md: MarkdownIcon,
  mdx: MarkdownIcon,
  svg: SvgFileIcon,
  xml: XmlIcon,
  csv: CsvIcon,
  yaml: ConfigIcon,
  yml: ConfigIcon,
  toml: ConfigIcon,
  ini: ConfigIcon,
  env: ConfigIcon,
  properties: ConfigIcon,
  cfg: ConfigIcon,
  conf: ConfigIcon,
  // Images
  png: ImageIcon,
  jpg: ImageIcon,
  jpeg: ImageIcon,
  gif: ImageIcon,
  webp: ImageIcon,
  ico: ImageIcon,
  bmp: ImageIcon,
  tiff: ImageIcon,
  tif: ImageIcon,
  // DB
  sql: SqlIcon,
  prisma: PrismaIcon,
  graphql: GraphqlIcon,
  gql: GraphqlIcon,
  // Shell / Scripts
  sh: ShellIcon,
  bash: ShellIcon,
  zsh: ShellIcon,
  ps1: PowershellIcon,
  psd1: PowershellIcon,
  psm1: PowershellIcon,
  bat: ShellIcon,
  cmd: ShellIcon,
  fish: ShellIcon,
  // Lock
  lock: LockIcon,
  // Archives
  zip: ZipIcon,
  tar: ZipIcon,
  gz: ZipIcon,
  bz2: ZipIcon,
  xz: ZipIcon,
  '7z': ZipIcon,
  rar: ZipIcon,
  // Documents
  pdf: PdfIcon,
  doc: DocIcon,
  docx: DocIcon,
  xls: XlsIcon,
  xlsx: XlsIcon,
  ppt: PptIcon,
  pptx: PptIcon,
  odt: DocIcon,
  ods: XlsIcon,
  odp: PptIcon,
  rtf: DocIcon,
  txt: LogIcon,
  log: LogIcon,
  // Binary
  exe: ExeIcon,
  dll: ExeIcon,
  so: ExeIcon,
  dylib: ExeIcon,
  bin: ExeIcon,
  o: ExeIcon,
  a: ExeIcon,
  lib: ExeIcon,
  // Frameworks / Tools
  next: NextJsIcon,
  vite: ViteIcon,
  // Other
  vim: VimIcon,
  nvim: VimIcon,
  el: VimIcon,
  vimrc: VimIcon,
  groovy: GroovyIcon,
  gvy: GroovyIcon,
  gradle: GradleIcon,
  m: ObjectiveCIcon,
  mm: ObjectiveCIcon,
  matlab: MatlabIcon,
  jl: JuliaIcon,
  f: FortranIcon,
  for: FortranIcon,
  f90: FortranIcon,
  f95: FortranIcon,
  asm: AssemblyIcon,
  nasm: AssemblyIcon,
  s: AssemblyIcon,
  fs: FsharpIcon,
  fsx: FsharpIcon,
  fsi: FsharpIcon,
  ml: OCamlIcon,
  mli: OCamlIcon,
  cob: CobolIcon,
  cbl: CobolIcon,
  cobol: CobolIcon,
  tf: TerraformIcon,
  tfvars: TerraformIcon,
  nginx: NginxIcon,
  dockerfile: DockerIcon,
  dockerignore: DockerIcon,
  jenkinsfile: CiIcon,
  ng: AngularIcon,
};

const SPECIAL_FOLDERS: Record<string, React.FC<IconProps>> = {
  src: SrcFolderIcon,
  'src-tauri': RustIcon,
  node_modules: NodeModulesFolderIcon,
  '.git': GitFolderIcon,
  dist: DistFolderIcon,
  build: DistFolderIcon,
  out: DistFolderIcon,
  '.next': NextJsIcon,
  '.nuxt': VueIcon,
  '.svelte-kit': SvelteIcon,
  test: TestFolderIcon,
  tests: TestFolderIcon,
  __tests__: TestFolderIcon,
  spec: TestFolderIcon,
  e2e: TestFolderIcon,
  docs: SrcFolderIcon,
  packages: SrcFolderIcon,
  apps: SrcFolderIcon,
  components: SrcFolderIcon,
  lib: SrcFolderIcon,
  utils: SrcFolderIcon,
  hooks: SrcFolderIcon,
  stores: SrcFolderIcon,
  styles: CssIcon,
  public: DistFolderIcon,
  assets: ImageIcon,
  icons: ImageIcon,
  images: ImageIcon,
  migrations: SqlIcon,
  prisma: PrismaIcon,
  '.github': CiIcon,
  '.gitlab': CiIcon,
  '.circleci': CiIcon,
  '.jenkins': CiIcon,
  docker: DockerIcon,
  '.docker': DockerIcon,
  terraform: TerraformIcon,
  k8s: KubernetesIcon,
  kubernetes: KubernetesIcon,
  nginx: NginxIcon,
};

// ═══════════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cache of data-URL → stable React FC component.
 * Stable references prevent unnecessary React unmount/remount cycles.
 */
const _urlIconCache = new Map<string, React.FC<IconProps>>();

function createUrlIcon(dataUrl: string): React.FC<IconProps> {
  if (!_urlIconCache.has(dataUrl)) {
    const UrlIcon: React.FC<IconProps> = ({ className = 'h-4 w-4' }) => (
      <img src={dataUrl} className={className} style={{ objectFit: 'contain' }} alt="" />
    );
    _urlIconCache.set(dataUrl, UrlIcon);
  }
  return _urlIconCache.get(dataUrl)!;
}

export function getFileIcon(name: string): React.FC<IconProps> {
  // 1. Active icon theme or language icon override
  const url = resolveFileIconUrl(name);
  if (url) return createUrlIcon(url);

  // 2. Built-in hardcoded icons
  const lower = name.toLowerCase();
  if (SPECIAL_FILES[lower]) return SPECIAL_FILES[lower];
  const ext = lower.split('.').pop() ?? '';
  if (EXT_ICONS[ext]) return EXT_ICONS[ext];

  return GenericFileIcon;
}

export function getFolderIcon(name: string, isOpen: boolean): React.FC<IconProps> {
  // 1. Active icon theme override
  const url = resolveFolderIconUrl(name, isOpen);
  if (url) return createUrlIcon(url);

  // 2. Built-in hardcoded icons
  const lower = name.toLowerCase();
  if (SPECIAL_FOLDERS[lower]) return SPECIAL_FOLDERS[lower];
  return isOpen ? FolderOpenIcon : FolderIcon;
}
