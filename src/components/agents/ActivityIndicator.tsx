import React, { useState, useEffect } from "react";

const PHRASES = [
  "Thinking",
  "Cogitating",
  "Processing",
  "Reflecting",
  "Analyzing",
  "Reasoning",
  "Pondering",
];

export const ActivityIndicator: React.FC = () => {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [dotCount, setDotCount] = useState(1);

  useEffect(() => {
    const dotInterval = setInterval(() => {
      setDotCount((prev) => (prev % 3) + 1);
    }, 500);
    return () => clearInterval(dotInterval);
  }, []);

  useEffect(() => {
    const phraseInterval = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % PHRASES.length);
    }, 3500);
    return () => clearInterval(phraseInterval);
  }, []);

  const dots = ".".repeat(dotCount);

  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <span className="relative flex h-3 w-3">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500" />
      </span>
      <span className="text-sm text-muted-foreground">
        {PHRASES[phraseIndex]}
        <span className="inline-block w-5 text-left">{dots}</span>
      </span>
    </div>
  );
};
