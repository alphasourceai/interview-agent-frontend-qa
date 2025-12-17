import { useEffect, useMemo, useRef, useState } from 'react';

export default function MultiSelect({ options = [], value = [], onChange, placeholder = 'Select...', className = '' }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const byId = useMemo(() => Object.fromEntries(options.map((o) => [o.id, o])), [options]);
  const display = useMemo(() => {
    const selected = value.map((id) => byId[id]?.label).filter(Boolean);
    if (selected.length === 0) return placeholder;
    if (selected.length <= 2) return selected.join(', ');
    return `${selected.length} selected`;
  }, [value, byId, placeholder]);

  useEffect(() => {
    const onClick = (e) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const toggle = () => setOpen((v) => !v);
  const toggleItem = (id) => {
    if (!onChange) return;
    const exists = value.includes(id);
    const next = exists ? value.filter((v) => v !== id) : [...value, id];
    onChange(next);
  };
  const clearAll = () => {
    if (onChange) onChange([]);
  };

  return (
    <div
      ref={containerRef}
      className={`multi-select ${open ? 'is-open' : ''} ${className || ''}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }}
    >
      <div className="multi-select__control" onClick={toggle}>
        <div className={`multi-select__value ${value.length === 0 ? 'is-placeholder' : ''}`}>
          {display}
        </div>
        <div className="multi-select__chevron" aria-hidden="true">{open ? '▲' : '▼'}</div>
      </div>
      {open && (
        <div className="multi-select__menu">
          <div className="multi-select__actions">
            <button type="button" className="multi-select__clear" onClick={clearAll}>Clear</button>
          </div>
          <div className="multi-select__list">
            {options.map((opt) => {
              const checked = value.includes(opt.id);
              return (
                <label key={opt.id} className="multi-select__item">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleItem(opt.id)}
                  />
                  <span>{opt.label}</span>
                </label>
              );
            })}
            {options.length === 0 && <div className="multi-select__empty">No options</div>}
          </div>
        </div>
      )}
    </div>
  );
}
