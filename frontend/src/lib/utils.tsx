import React from 'react';

export const highlightText = (text: string, highlight: string) => {
  if (!highlight.trim() || !text) {
    return text;
  }
  const escapedHighlight = highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedHighlight})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) => 
    part.toLowerCase() === highlight.toLowerCase() ? (
      <mark key={i} className="bg-app-ink text-app-bg px-1 rounded-sm">{part}</mark>
    ) : (
      part
    )
  );
};

export const cn = (...classes: (string | boolean | undefined | Record<string, boolean | undefined>)[]) => {
  return classes
    .flatMap(c => {
      if (typeof c === 'string') return c;
      if (typeof c === 'object' && c !== null) {
        return Object.entries(c)
          .filter(([_, value]) => Boolean(value))
          .map(([key]) => key);
      }
      return undefined;
    })
    .filter(Boolean)
    .join(' ');
};

export const isRTLLanguage = (language: string) => {
  return ["Arabic", "Hebrew", "Persian", "Urdu"].includes(language);
};

export const getRelativeTime = (timestamp?: number) => {
  if (!timestamp) return "Never";
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "Just now";
};

export const formatDateToLocalISO = (date: Date) => {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
