// utils/sortUtils.js

/**
 * Sorts Qlik hypercube rows by a single column, using either qNum or qText.
 * @param {Array} rows - 2D array from qMatrix
 * @param {number|null} sortBy - column index to sort on (null disables sort)
 * @param {boolean} sortDir - true for ascending, false for descending
 * @returns {Array} Sorted array of rows
 */
export function sortRows(rows, sortBy, sortDir = true) {
  // If no column is selected for sorting (null), return as-is (let Qlik handle it)
  if (sortBy === null) return rows;

  // Create a shallow copy and sort
  return [...rows].sort((a, b) => {
    // Use qNum if it's a valid number; fallback to qText
    const vA = !isNaN(a[sortBy].qNum) ? a[sortBy].qNum : a[sortBy].qText;
    const vB = !isNaN(b[sortBy].qNum) ? b[sortBy].qNum : b[sortBy].qText;
    if (vA === vB) return 0;
    // Compare values; ascending if sortDir true, else descending
    if (sortDir) return vA > vB ? 1 : -1;
    return vA < vB ? 1 : -1;
  });
}
