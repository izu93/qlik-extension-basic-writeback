// Paginate a flat rows array given a page index and page size
export function getPagedRows(rows, page, pageSize) {
  const totalRows = rows.length;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;
  const pagedRows = rows.slice(page * pageSize, (page + 1) * pageSize);
  return { pagedRows, totalPages };
}
