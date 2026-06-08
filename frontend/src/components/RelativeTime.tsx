import React, { useState, useEffect } from 'react';
import { getRelativeTime } from '../lib/utils';

interface RelativeTimeProps {
  timestamp?: number;
  className?: string;
}

export const RelativeTime: React.FC<RelativeTimeProps> = ({ timestamp, className }) => {
  const [relativeTime, setRelativeTime] = useState(getRelativeTime(timestamp));

  useEffect(() => {
    // Update immediately when timestamp changes
    setRelativeTime(getRelativeTime(timestamp));
    
    if (!timestamp) return;

    const interval = setInterval(() => {
      setRelativeTime(getRelativeTime(timestamp));
    }, 10000); // Update every 10 seconds for better responsiveness

    return () => clearInterval(interval);
  }, [timestamp]);

  return <span className={className}>{relativeTime}</span>;
};
