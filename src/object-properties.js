export default {
  qHyperCubeDef: {
    qDimensions: [],
    qMeasures: [],
    qInitialDataFetch: [{ qWidth: 10, qHeight: 1000 }],
  },
  showTitles: true,
  title: "",
  subtitle: "",
  footnote: "",
  disableNavMenu: false,
  showDetails: false,

  // Key Dimensions Configuration
  keyDimensions: [],
  keyGenerationStrategy: "concatenate",
  keySeparator: "|",
  showKeyInTable: false,
  validateKeyUniqueness: true,

  // Dynamic Writeback Configuration - starts empty
  writebackConfig: {
    enabled: false,
    columns: [],
  },
};
