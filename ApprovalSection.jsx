import React, { useEffect, useRef } from 'react';

export default function ApprovalSection({ title, children, className = 'local-approval' }) {
  const section = useRef(null);
  const heading = useRef(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      for (let parent = section.current?.parentElement; parent; parent = parent.parentElement) {
        if (parent.tagName === 'DETAILS') parent.open = true;
      }
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
      });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return <section ref={section} className={className} role="region" aria-label={title}>
    <h3 ref={heading} tabIndex={-1} className="approval-heading">{title}</h3>
    {children}
  </section>;
}
