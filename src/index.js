import { useElement, useLayout, useEffect } from "@nebula.js/stardust";
import ext from "./ext";
import properties from "./object-properties";
import data from "./data";

export default function supernova(galaxy) {
  return {
    qae: {
      properties,
      data,
    },
    ext: ext(galaxy),
    component() {
      const element = useElement();
      const layout = useLayout();

      useEffect(() => {
        // Show 'Hello Qlik!' until you add dimensions/measures
        if (!layout.qHyperCube || !layout.qHyperCube.qDimensionInfo.length) {
          element.innerHTML =
            "<div>No data yet.<br/>Add a dimension and a measure.</div>";
          return;
        }

        // Display data as table for testing
        const hc = layout.qHyperCube;
        const columns = [...hc.qDimensionInfo, ...hc.qMeasureInfo].map(
          (f) => f.qFallbackTitle
        );
        const header = `<thead><tr>${columns
          .map((c) => `<th>${c}</th>`)
          .join("")}</tr></thead>`;
        const rows = hc.qDataPages[0].qMatrix
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${cell.qText}</td>`).join("")}</tr>`
          )
          .join("");
        const table = `<table border="1">${header}<tbody>${rows}</tbody></table>`;

        element.innerHTML = table;
      }, [element, layout]);
    },
  };
}
