import React from 'react';

function visiblePages(page, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  return [...pages].filter(value => value >= 1 && value <= totalPages).sort((a, b) => a - b);
}

export default function Pagination({ page, totalPages, total, start, end, onPage }) {
  if (total === 0) return null;
  const pages = visiblePages(page, totalPages);

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 pt-3 text-sm" aria-label="Pagination">
      <span className="text-slate-600">
        Showing <span className="font-semibold text-slate-900">{start}–{end}</span> of {total}
        <span className="ml-2 text-slate-500">· Page {page} of {totalPages}</span>
      </span>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-50">Previous</button>
        {pages.map((value, index) => (
          <React.Fragment key={value}>
            {index > 0 && value - pages[index - 1] > 1 && <span className="px-1 text-slate-400" aria-hidden="true">…</span>}
            <button
              type="button"
              onClick={() => onPage(value)}
              aria-current={page === value ? 'page' : undefined}
              aria-label={`Page ${value}`}
              className={`min-w-9 px-3 py-1.5 rounded-lg border ${page === value ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              {value}
            </button>
          </React.Fragment>
        ))}
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= totalPages} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-50">Next</button>
      </div>
    </nav>
  );
}
