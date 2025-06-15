// Extract header labels from hypercube layout
export function getColumns(layout) {
  if (
    !layout ||
    !layout.qHyperCube ||
    (!layout.qHyperCube.qDimensionInfo && !layout.qHyperCube.qMeasureInfo)
  ) {
    return [];
  }
  return [
    ...(layout.qHyperCube.qDimensionInfo || []),
    ...(layout.qHyperCube.qMeasureInfo || []),
  ].map((f) => f.qFallbackTitle);
}

// Extract row matrix from hypercube layout
export function getRows(layout) {
  return layout?.qHyperCube?.qDataPages?.[0]?.qMatrix || [];
}
