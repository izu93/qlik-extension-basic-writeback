// Import required Qlik nebula.js hooks and local config modules
import { useElement, useLayout, useEffect } from "@nebula.js/stardust";
import ext from "./ext";
import properties from "./object-properties";
import data from "./data";

/**
 * Main extension entry point (supernova)
 * @param {object} galaxy - Provided by Qlik/nebula.js at runtime
 */
export default function supernova(galaxy) {
  return {
    // qae: Qlik Associative Engine config - describes what data you want from Qlik
    qae: {
      properties, // Default object properties (including qHyperCubeDef)
      data, // Data structure definition (dimensions, measures, etc.)
    },

    // ext: Property panel configuration for the extension
    ext: ext(galaxy),

    /**
     * Main component renderer. Runs each time the extension updates or data changes.
     */
    component() {
      // Get references to the extension's DOM element and the current layout (data, selections, etc.)
      const element = useElement();
      const layout = useLayout();

      // React-like effect: Runs each time 'element' or 'layout' changes
      useEffect(() => {
        // If there is no data defined (no dimensions/measures yet), prompt the user to add some
        if (!layout.qHyperCube || !layout.qHyperCube.qDimensionInfo.length) {
          element.innerHTML =
            "<div>No data yet.<br/>Add a dimension and a measure.</div>";
          return; // Exit early, nothing more to render
        }

        // --- Table Rendering Logic ---

        // 1. Get Qlik hypercube (table) structure from layout
        const hc = layout.qHyperCube;

        // 2. Extract column headers (dimension & measure titles)
        const columns = [...hc.qDimensionInfo, ...hc.qMeasureInfo].map(
          (f) => f.qFallbackTitle
        );

        // 3. Render HTML <thead> row for table headers
        const header = `<thead><tr>${columns
          .map((c) => `<th>${c}</th>`)
          .join("")}</tr></thead>`;

        // 4. Render HTML rows for each record in qMatrix (array of arrays)
        const rows = hc.qDataPages[0].qMatrix
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${cell.qText}</td>`).join("")}</tr>`
          )
          .join("");

        // 5. Compose the full HTML table string
        const table = `<table border="1">${header}<tbody>${rows}</tbody></table>`;

        // 6. Write the HTML table into the extension's DOM node
        element.innerHTML = table;
      }, [element, layout]); // Run effect when 'element' or 'layout' changes
    },
  };
}
